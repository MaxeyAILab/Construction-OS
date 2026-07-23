import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { budgetLines, budgets, commitments, purchaseOrderLines, purchaseOrders } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  NoActiveBudgetForProjectError,
  PurchaseOrderIllegalTransitionError,
  PurchaseOrderNotCancellableError,
  PurchaseOrderNotPendingApprovalError,
} from "../domain/errors";
import { PurchaseOrdersService } from "./purchase-orders.service";

// api.md §11: "state machine on POST {id}/submit|approve|send|cancel —
// approval writes commitment atomically (FR-PROC-3)." confirm/close are
// gap-fills for the two remaining database.md status values with no
// documented entry point of their own (same "the enum requires it, so
// gap-fill it" precedent as ChangeOrderLifecycleService's reject/void) —
// 'confirmed' is a plausible future Supplier Portal (M15) action and
// 'closed' a plausible future post-receipt reconciliation action; both
// are exposed here as plain internal transitions until those modules
// exist to make a more specific call. 'partially_received'/'received' are
// set by DeliveriesService from actual receipt quantities, not here.
@Injectable()
export class PurchaseOrderLifecycleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
  ) {}

  async submit(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, "draft", "pending_approval");
  }

  async send(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, "approved", "sent");
  }

  async confirm(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, "sent", "confirmed");
  }

  async close(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, "received", "closed");
  }

  // FR-PROC-3: "link POs to budget cost codes, creating commitments in
  // Finance (M9)." One commitments row per cost code represented on the
  // PO's lines (grouped/summed, since commitments has a single
  // cost_code_id per row) — writes directly to budgets/budget_lines via
  // the shared schema import rather than calling BudgetService, same
  // cross-module-atomicity justification as
  // ChangeOrderLifecycleService.approve().
  async approve(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const po = await this.purchaseOrdersService.requirePurchaseOrder(tx, id);
      if (po.status !== "pending_approval") throw new PurchaseOrderNotPendingApprovalError();

      const budget = await tx.query.budgets.findFirst({
        where: and(eq(budgets.projectId, po.projectId), eq(budgets.status, "active")),
      });
      if (!budget) throw new NoActiveBudgetForProjectError();

      const lines = await tx.query.purchaseOrderLines.findMany({
        where: and(eq(purchaseOrderLines.purchaseOrderId, id), isNull(purchaseOrderLines.deletedAt)),
      });

      const totalsByCostCode = new Map<string, number>();
      for (const line of lines) {
        const current = totalsByCostCode.get(line.costCodeId) ?? 0;
        totalsByCostCode.set(line.costCodeId, current + Number(line.lineTotalAmount));
      }

      for (const [costCodeId, amount] of totalsByCostCode) {
        const amountStr = amount.toFixed(2);
        await tx.insert(commitments).values({
          tenantId,
          projectId: po.projectId,
          costCodeId,
          kind: "purchase_order",
          sourceId: po.id,
          amount: amountStr,
          status: "active",
          createdBy: actorId,
        });

        const existingLine = await tx.query.budgetLines.findFirst({
          where: and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.costCodeId, costCodeId)),
        });

        let touchedLineId: string;
        if (!existingLine) {
          const [inserted] = await tx
            .insert(budgetLines)
            .values({
              tenantId,
              budgetId: budget.id,
              costCodeId,
              committedAmount: amountStr,
              createdBy: actorId,
            })
            .returning();
          touchedLineId = inserted!.id;
        } else {
          const newCommitted = (Number(existingLine.committedAmount) + amount).toFixed(2);
          await tx
            .update(budgetLines)
            .set({ committedAmount: newCommitted, updatedBy: actorId })
            .where(eq(budgetLines.id, existingLine.id));
          touchedLineId = existingLine.id;
        }

        const touched = await tx.query.budgetLines.findFirst({ where: eq(budgetLines.id, touchedLineId) });
        await this.outbox.append(tx, {
          tenantId,
          eventType: "budget_line.updated.v1",
          dedupeKey: `budget_line.updated.v1:${touched!.id}:${touched!.updatedSeq}`,
          actorId,
          payload: {
            companyId: tenantId,
            projectId: po.projectId,
            budgetId: budget.id,
            budgetLineId: touched!.id,
            changedFields: ["committedAmount"],
          },
        });
      }

      const [approved] = await tx
        .update(purchaseOrders)
        .set({ status: "approved", approvedBy: actorId, approvedAt: new Date(), updatedBy: actorId })
        .where(eq(purchaseOrders.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "purchase_order.approved.v1",
        dedupeKey: `purchase_order.approved.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, projectId: po.projectId, purchaseOrderId: id, totalAmount: approved!.totalAmount },
      });

      return approved!;
    });
  }

  // Reverses the commitment(s) written by approve() when a PO is cancelled
  // after having been approved — cancellable from any pre-receipt state.
  async cancel(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const po = await this.purchaseOrdersService.requirePurchaseOrder(tx, id);
      const cancellableStatuses = ["draft", "pending_approval", "approved", "sent", "confirmed"];
      if (!cancellableStatuses.includes(po.status)) throw new PurchaseOrderNotCancellableError();

      if (po.approvedAt) {
        const activeCommitments = await tx.query.commitments.findMany({
          where: and(eq(commitments.sourceId, po.id), eq(commitments.kind, "purchase_order"), eq(commitments.status, "active")),
        });

        const budget = await tx.query.budgets.findFirst({
          where: and(eq(budgets.projectId, po.projectId), eq(budgets.status, "active")),
        });

        for (const commitment of activeCommitments) {
          await tx
            .update(commitments)
            .set({ status: "cancelled", updatedBy: actorId })
            .where(eq(commitments.id, commitment.id));

          if (budget) {
            const line = await tx.query.budgetLines.findFirst({
              where: and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.costCodeId, commitment.costCodeId)),
            });
            if (line) {
              const newCommitted = (Number(line.committedAmount) - Number(commitment.amount)).toFixed(2);
              await tx
                .update(budgetLines)
                .set({ committedAmount: newCommitted, updatedBy: actorId })
                .where(eq(budgetLines.id, line.id));

              await this.outbox.append(tx, {
                tenantId,
                eventType: "budget_line.updated.v1",
                dedupeKey: `budget_line.updated.v1:${line.id}:cancel:${commitment.id}`,
                actorId,
                payload: {
                  companyId: tenantId,
                  projectId: po.projectId,
                  budgetId: budget.id,
                  budgetLineId: line.id,
                  changedFields: ["committedAmount"],
                },
              });
            }
          }
        }
      }

      const [cancelled] = await tx
        .update(purchaseOrders)
        .set({ status: "cancelled", updatedBy: actorId })
        .where(eq(purchaseOrders.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "purchase_order.updated.v1",
        dedupeKey: `purchase_order.updated.v1:${id}:${cancelled!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, projectId: po.projectId, purchaseOrderId: id, changedFields: ["status"] },
      });

      return cancelled!;
    });
  }

  private async transition(tenantId: string, actorId: string, id: string, fromStatus: string, toStatus: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const po = await this.purchaseOrdersService.requirePurchaseOrder(tx, id);
      if (po.status !== fromStatus) throw new PurchaseOrderIllegalTransitionError(fromStatus);

      const [updated] = await tx
        .update(purchaseOrders)
        .set({ status: toStatus, updatedBy: actorId })
        .where(eq(purchaseOrders.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "purchase_order.updated.v1",
        dedupeKey: `purchase_order.updated.v1:${id}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, projectId: po.projectId, purchaseOrderId: id, changedFields: ["status"] },
      });

      return updated!;
    });
  }
}
