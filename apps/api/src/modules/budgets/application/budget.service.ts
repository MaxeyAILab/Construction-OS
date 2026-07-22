import { Inject, Injectable } from "@nestjs/common";
import type { CreateBudgetInput, CreateBudgetLineInput, UpdateBudgetLineInput } from "@constructionos/schemas";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { budgetLines, budgets, costCodes, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  ActiveBudgetAlreadyExistsError,
  BudgetLineNotFoundError,
  BudgetLockedError,
  BudgetNotFoundError,
  CostCodeNotOnProjectError,
  DuplicateBudgetLineError,
  ProjectNotFoundError,
} from "../domain/errors";

@Injectable()
export class BudgetService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async create(tenantId: string, actorId: string, projectId: string, input: CreateBudgetInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      const existing = await tx.query.budgets.findFirst({
        where: and(eq(budgets.projectId, projectId), eq(budgets.status, "active")),
      });
      if (existing) throw new ActiveBudgetAlreadyExistsError();

      const [budget] = await tx
        .insert(budgets)
        .values({
          tenantId,
          projectId,
          sourceEstimateId: input.sourceEstimateId,
          currency: input.currency,
          createdBy: actorId,
        })
        .returning();
      const created = budget!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "budget.created.v1",
        dedupeKey: `budget.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, budgetId: created.id },
      });

      return created;
    });
  }

  async getByProject(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const budget = await tx.query.budgets.findFirst({
        where: and(eq(budgets.projectId, projectId), eq(budgets.status, "active")),
      });
      if (!budget) throw new BudgetNotFoundError();

      const lines = await tx.query.budgetLines.findMany({ where: eq(budgetLines.budgetId, budget.id) });
      return { ...budget, lines };
    });
  }

  async addLine(tenantId: string, actorId: string, budgetId: string, input: CreateBudgetLineInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const budget = await tx.query.budgets.findFirst({ where: eq(budgets.id, budgetId) });
      if (!budget) throw new BudgetNotFoundError();
      if (budget.status === "locked") throw new BudgetLockedError();

      const costCode = await tx.query.costCodes.findFirst({
        where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, budget.projectId)),
      });
      if (!costCode) throw new CostCodeNotOnProjectError();

      const existing = await tx.query.budgetLines.findFirst({
        where: and(eq(budgetLines.budgetId, budgetId), eq(budgetLines.costCodeId, input.costCodeId)),
      });
      if (existing) throw new DuplicateBudgetLineError();

      const [line] = await tx
        .insert(budgetLines)
        .values({
          tenantId,
          budgetId,
          costCodeId: input.costCodeId,
          originalAmount: input.originalAmount,
          forecastToCompleteAmount: input.originalAmount,
          forecastAtCompletionAmount: input.originalAmount,
          createdBy: actorId,
        })
        .returning();
      const created = line!;

      await this.recomputeBudgetTotals(tx, budgetId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "budget_line.created.v1",
        dedupeKey: `budget_line.created.v1:${created.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: budget.projectId,
          budgetId,
          budgetLineId: created.id,
          costCodeId: input.costCodeId,
        },
      });

      return created;
    });
  }

  async updateLineOriginalAmount(
    tenantId: string,
    actorId: string,
    budgetId: string,
    lineId: string,
    input: UpdateBudgetLineInput,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const budget = await tx.query.budgets.findFirst({ where: eq(budgets.id, budgetId) });
      if (!budget) throw new BudgetNotFoundError();
      if (budget.status === "locked") throw new BudgetLockedError();

      const line = await tx.query.budgetLines.findFirst({
        where: and(eq(budgetLines.id, lineId), eq(budgetLines.budgetId, budgetId)),
      });
      if (!line) throw new BudgetLineNotFoundError();

      // forecastToComplete stays budget-based (revised - actual); revised
      // moves with originalAmount via the generated column, so recompute
      // forecast here too rather than leaving it stale until the next
      // cost transaction posts.
      const newForecastToComplete = (
        Number(input.originalAmount) +
        Number(line.approvedChangesAmount) -
        Number(line.actualAmount)
      ).toFixed(2);

      const [updated] = await tx
        .update(budgetLines)
        .set({
          originalAmount: input.originalAmount,
          forecastToCompleteAmount: newForecastToComplete,
          forecastAtCompletionAmount: (Number(line.actualAmount) + Number(newForecastToComplete)).toFixed(2),
          updatedBy: actorId,
        })
        .where(eq(budgetLines.id, lineId))
        .returning();

      await this.recomputeBudgetTotals(tx, budgetId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "budget_line.updated.v1",
        dedupeKey: `budget_line.updated.v1:${lineId}:${updated!.updatedSeq}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: budget.projectId,
          budgetId,
          budgetLineId: lineId,
          changedFields: ["originalAmount"],
        },
      });

      return updated!;
    });
  }

  // database.md §11: originalTotalAmount/revisedTotalAmount on `budgets`
  // are maintained aggregates (Postgres generated columns can't sum across
  // other tables) — recomputed here whenever a line is added or changed,
  // in the same transaction.
  private async recomputeBudgetTotals(tx: Database, budgetId: string): Promise<void> {
    const [totals] = await tx
      .select({
        original: sql<string>`coalesce(sum(${budgetLines.originalAmount}), 0)`,
        revised: sql<string>`coalesce(sum(${budgetLines.revisedAmount}), 0)`,
      })
      .from(budgetLines)
      .where(eq(budgetLines.budgetId, budgetId));

    await tx
      .update(budgets)
      .set({
        originalTotalAmount: totals!.original,
        revisedTotalAmount: totals!.revised,
      })
      .where(eq(budgets.id, budgetId));
  }
}
