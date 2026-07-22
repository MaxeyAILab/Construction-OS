import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { budgetLines, budgets, costCodes, estimateLines, estimates } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ActiveBudgetAlreadyExistsError, EstimateNotFoundError } from "../domain/errors";

// api.md §5: "Atomic estimate→budget with cost-code mapping (FR-EST-5).
// 409 if active budget exists." Budgets and cost codes are owned by other
// modules (Finance/Projects) — architecture.md §4.2's cross-module rule is
// "via index.ts services (sync) or domain events (async)", but a same-
// transaction atomic write across those tables can't go through another
// module's own withTenant(...) call (that opens its own transaction on its
// own connection — see infrastructure/db/client.ts). So this writes
// directly to the owned tables via the shared schema module (not a module-
// boundary violation under the CI-enforced import/no-restricted-paths rule,
// which only blocks importing another module's application/domain/
// infrastructure code, not the shared schema) and emits the exact same
// event types (budget.created.v1, cost_code.created.v1) those modules'
// own services would have emitted, so downstream consumers/audit see no
// difference.
@Injectable()
export class ConvertToBudgetService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async convert(tenantId: string, actorId: string, estimateId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const estimate = await tx.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
      if (!estimate) throw new EstimateNotFoundError();
      const projectId = estimate.projectId!;

      const existingBudget = await tx.query.budgets.findFirst({
        where: and(eq(budgets.projectId, projectId), eq(budgets.status, "active")),
      });
      if (existingBudget) throw new ActiveBudgetAlreadyExistsError();

      const lines = await tx.query.estimateLines.findMany({
        where: and(eq(estimateLines.estimateId, estimateId), isNull(estimateLines.deletedAt)),
      });

      // Multiple estimate lines can share a cost_code_ref (e.g. several
      // manual lines against the same code) — budget_lines has one row per
      // cost code (ux_budget_lines_budget_cost_code), so they're aggregated
      // here before insertion.
      const amountByCostCodeRef = new Map<string, number>();
      for (const line of lines) {
        amountByCostCodeRef.set(
          line.costCodeRef,
          (amountByCostCodeRef.get(line.costCodeRef) ?? 0) + Number(line.totalCostAmount),
        );
      }

      const [budget] = await tx
        .insert(budgets)
        .values({ tenantId, projectId, sourceEstimateId: estimateId, currency: estimate.currency, createdBy: actorId })
        .returning();
      const createdBudget = budget!;

      const createdLines: (typeof budgetLines.$inferSelect)[] = [];
      let totalAmount = 0;
      for (const [costCodeRef, amount] of amountByCostCodeRef) {
        let costCode = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.projectId, projectId), eq(costCodes.code, costCodeRef)),
        });
        if (!costCode) {
          // No kind information travels with a text cost_code_ref — 'other'
          // is the documented default until someone edits the cost code
          // directly on the project.
          const [newCostCode] = await tx
            .insert(costCodes)
            .values({ tenantId, projectId, code: costCodeRef, name: costCodeRef, kind: "other", createdBy: actorId })
            .returning();
          costCode = newCostCode!;

          await this.outbox.append(tx, {
            tenantId,
            eventType: "cost_code.created.v1",
            dedupeKey: `cost_code.created.v1:${costCode.id}`,
            actorId,
            payload: { companyId: tenantId, projectId, costCodeId: costCode.id, code: costCode.code },
          });
        }

        const originalAmount = amount.toFixed(2);
        const [line] = await tx
          .insert(budgetLines)
          .values({
            tenantId,
            budgetId: createdBudget.id,
            costCodeId: costCode.id,
            originalAmount,
            forecastToCompleteAmount: originalAmount,
            forecastAtCompletionAmount: originalAmount,
            createdBy: actorId,
          })
          .returning();
        createdLines.push(line!);
        totalAmount += amount;
      }

      await tx
        .update(budgets)
        .set({ originalTotalAmount: totalAmount.toFixed(2), revisedTotalAmount: totalAmount.toFixed(2) })
        .where(eq(budgets.id, createdBudget.id));

      // Converting to a budget is this codebase's only signal today that
      // an estimate was accepted — there's no separate "accept" action
      // documented, so this is the natural point to mark it won.
      await tx.update(estimates).set({ status: "won", updatedBy: actorId }).where(eq(estimates.id, estimateId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "budget.created.v1",
        dedupeKey: `budget.created.v1:${createdBudget.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, budgetId: createdBudget.id },
      });
      await this.outbox.append(tx, {
        tenantId,
        eventType: "estimate.updated.v1",
        dedupeKey: `estimate.updated.v1:${estimateId}:convert-to-budget`,
        actorId,
        payload: { companyId: tenantId, projectId, estimateId, changedFields: ["status"] },
      });

      return { ...createdBudget, originalTotalAmount: totalAmount.toFixed(2), revisedTotalAmount: totalAmount.toFixed(2), lines: createdLines };
    });
  }
}
