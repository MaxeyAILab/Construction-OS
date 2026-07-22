import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { budgetLines, budgets, changeOrderLines, changeOrders } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ExternalSharesService, PermissionResolverService } from "../../rbac";
import {
  ChangeOrderApprovalDeniedError,
  ChangeOrderNotDraftError,
  ChangeOrderNotPendingClientError,
  NoActiveBudgetForProjectError,
} from "../domain/errors";
import { ChangeOrdersService } from "./change-orders.service";

// api.md §9: submit-to-client and approve are two separate steps
// (draft -> pending_client -> approved/rejected); void can happen from
// either pre-terminal state. Approve's budget propagation writes directly
// to budgets/budget_lines via the shared schema import rather than calling
// BudgetService — same cross-module-atomicity justification as
// Estimating's ConvertToBudgetService (another module's own withTenant(...)
// call opens its own transaction on its own connection, which can't share
// this one).
@Injectable()
export class ChangeOrderLifecycleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly changeOrdersService: ChangeOrdersService,
    private readonly permissions: PermissionResolverService,
    private readonly externalShares: ExternalSharesService,
  ) {}

  // Gap-fill: api.md §9 documents this as "Publishes to portal +
  // notification" — no client portal exists yet to publish to, and no
  // notification consumer is wired for this event (flagged follow-up,
  // same as convert-to-budget's cost-code kind default).
  async submitToClient(tenantId: string, actorId: string, changeOrderId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.changeOrdersService.requireChangeOrder(tx, changeOrderId);
      if (co.status !== "draft") throw new ChangeOrderNotDraftError();

      const [updated] = await tx
        .update(changeOrders)
        .set({ status: "pending_client", updatedBy: actorId })
        .where(eq(changeOrders.id, changeOrderId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order.updated.v1",
        dedupeKey: `change_order.updated.v1:${changeOrderId}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, projectId: co.projectId, changeOrderId, changedFields: ["status"] },
      });

      return updated!;
    });
  }

  // Gap-fill: api.md §9 only documents approve, but the status enum
  // includes 'rejected' and there's no other way to reach it.
  async reject(tenantId: string, actorId: string, changeOrderId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.changeOrdersService.requireChangeOrder(tx, changeOrderId);
      if (co.status !== "pending_client") throw new ChangeOrderNotPendingClientError();

      const [updated] = await tx
        .update(changeOrders)
        .set({ status: "rejected", updatedBy: actorId })
        .where(eq(changeOrders.id, changeOrderId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order.updated.v1",
        dedupeKey: `change_order.updated.v1:${changeOrderId}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, projectId: co.projectId, changeOrderId, changedFields: ["status"] },
      });

      return updated!;
    });
  }

  // Gap-fill: same reasoning as reject — void is in the status enum with
  // no other documented entry point.
  async void(tenantId: string, actorId: string, changeOrderId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.changeOrdersService.requireChangeOrder(tx, changeOrderId);
      if (co.status !== "draft" && co.status !== "pending_client") throw new ChangeOrderNotDraftError();

      const [updated] = await tx
        .update(changeOrders)
        .set({ status: "void", updatedBy: actorId })
        .where(eq(changeOrders.id, changeOrderId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order.updated.v1",
        dedupeKey: `change_order.updated.v1:${changeOrderId}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, projectId: co.projectId, changeOrderId, changedFields: ["status"] },
      });

      return updated!;
    });
  }

  // FR-FIN-2: "On approval (one transaction): budget_lines.approved_changes
  // update + schedule impact event + client-portal visibility." The actual
  // schedule re-flow has no consumer yet (Scheduling AI impact simulation,
  // FR-SCH-6, is a later roadmap row) — this emits change_order.approved.v1
  // carrying schedule_impact_days so a future consumer can react, and the
  // budget propagation is real and atomic today.
  //
  // api.md §9: "finance.co.approve (internal) or portal principal via
  // share" — two independent authorization paths for the same action
  // (architecture.md §11/12's application-layer record-level rules, not a
  // single @RequirePermission key; see the controller's @Authenticated()).
  // Only the share path stamps client_approved_by/at/channel — those
  // columns exist specifically to distinguish "an employee approved this
  // internally" from "the client approved it via the portal."
  async approve(tenantId: string, actorId: string, changeOrderId: string) {
    const hasInternalPermission = await this.permissions.has(tenantId, actorId, "finance.co.approve");
    const viaShare = !hasInternalPermission
      ? await this.externalShares.hasAccess(tenantId, actorId, "change_order", changeOrderId, "approve")
      : false;
    if (!hasInternalPermission && !viaShare) throw new ChangeOrderApprovalDeniedError();

    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.changeOrdersService.requireChangeOrder(tx, changeOrderId);
      if (co.status !== "pending_client") throw new ChangeOrderNotPendingClientError();

      const budget = await tx.query.budgets.findFirst({
        where: and(eq(budgets.projectId, co.projectId), eq(budgets.status, "active")),
      });
      if (!budget) throw new NoActiveBudgetForProjectError();

      const lines = await tx.query.changeOrderLines.findMany({
        where: and(eq(changeOrderLines.changeOrderId, changeOrderId), isNull(changeOrderLines.deletedAt)),
      });

      for (const line of lines) {
        const existing = await tx.query.budgetLines.findFirst({
          where: and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.costCodeId, line.costCodeId)),
        });

        if (!existing) {
          const approvedChanges = line.costImpactAmount;
          await tx.insert(budgetLines).values({
            tenantId,
            budgetId: budget.id,
            costCodeId: line.costCodeId,
            originalAmount: "0.00",
            approvedChangesAmount: approvedChanges,
            forecastToCompleteAmount: approvedChanges,
            forecastAtCompletionAmount: approvedChanges,
            createdBy: actorId,
          });
        } else {
          // Same forecast formula as BudgetService.updateLineOriginalAmount
          // (forecastToComplete = revised - actual; FAC = actual + FTC) —
          // revised_amount is a generated column, so it's recomputed here
          // from original + the new approved_changes rather than re-read.
          const newApprovedChanges = (
            Number(existing.approvedChangesAmount) + Number(line.costImpactAmount)
          ).toFixed(2);
          const revised = Number(existing.originalAmount) + Number(newApprovedChanges);
          const newForecastToComplete = (revised - Number(existing.actualAmount)).toFixed(2);
          await tx
            .update(budgetLines)
            .set({
              approvedChangesAmount: newApprovedChanges,
              forecastToCompleteAmount: newForecastToComplete,
              forecastAtCompletionAmount: (Number(existing.actualAmount) + Number(newForecastToComplete)).toFixed(2),
              updatedBy: actorId,
            })
            .where(eq(budgetLines.id, existing.id));
        }

        const touched = await tx.query.budgetLines.findFirst({
          where: and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.costCodeId, line.costCodeId)),
        });
        await this.outbox.append(tx, {
          tenantId,
          eventType: "budget_line.updated.v1",
          dedupeKey: `budget_line.updated.v1:${touched!.id}:${touched!.updatedSeq}`,
          actorId,
          payload: {
            companyId: tenantId,
            projectId: co.projectId,
            budgetId: budget.id,
            budgetLineId: touched!.id,
            changedFields: ["approvedChangesAmount"],
          },
        });
      }

      await this.recomputeBudgetTotals(tx, budget.id);

      const [approvedCo] = await tx
        .update(changeOrders)
        .set({
          status: "approved",
          updatedBy: actorId,
          ...(viaShare
            ? { clientApprovedBy: actorId, clientApprovedAt: new Date(), clientApprovalChannel: "portal" }
            : {}),
        })
        .where(eq(changeOrders.id, changeOrderId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order.approved.v1",
        dedupeKey: `change_order.approved.v1:${changeOrderId}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: co.projectId,
          changeOrderId,
          costImpactAmount: co.costImpactAmount,
          scheduleImpactDays: co.scheduleImpactDays,
        },
      });

      return approvedCo!;
    });
  }

  private async recomputeBudgetTotals(tx: Database, budgetId: string): Promise<void> {
    const rows = await tx.query.budgetLines.findMany({ where: eq(budgetLines.budgetId, budgetId) });
    const original = rows.reduce((sum, r) => sum + Number(r.originalAmount), 0).toFixed(2);
    const revised = rows.reduce((sum, r) => sum + Number(r.originalAmount) + Number(r.approvedChangesAmount), 0).toFixed(2);

    await tx
      .update(budgets)
      .set({ originalTotalAmount: original, revisedTotalAmount: revised })
      .where(eq(budgets.id, budgetId));
  }
}
