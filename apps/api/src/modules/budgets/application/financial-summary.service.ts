import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { budgetLines, budgets, projects } from "../../../infrastructure/db/schema";
import { ProjectNotFoundError } from "../domain/errors";

function sum(values: string[]): number {
  return values.reduce((total, v) => total + Number(v), 0);
}

function toMoney(n: number): string {
  return n.toFixed(2);
}

// FR-FIN-3: "live cost-to-complete and projected margin per project."
// database.md §11: "the live-margin view is a plain read, always exact,
// no reconciliation job" — budget_lines' maintained columns are summed
// live here, nothing is pre-aggregated/cached.
@Injectable()
export class FinancialSummaryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      const budget = await tx.query.budgets.findFirst({
        where: and(eq(budgets.projectId, projectId), eq(budgets.status, "active")),
      });

      const lines = budget
        ? await tx.query.budgetLines.findMany({ where: eq(budgetLines.budgetId, budget.id) })
        : [];

      const totalOriginal = sum(lines.map((l) => l.originalAmount));
      const totalRevised = sum(lines.map((l) => l.revisedAmount ?? "0"));
      const totalCommitted = sum(lines.map((l) => l.committedAmount));
      const totalActual = sum(lines.map((l) => l.actualAmount));
      // CTC (cost-to-complete): sum of each line's remaining budget-based
      // forecast. FAC (forecast-at-completion): actual + CTC.
      const costToComplete = sum(lines.map((l) => l.forecastToCompleteAmount));
      const forecastAtCompletion = sum(lines.map((l) => l.forecastAtCompletionAmount));
      // Cost variance: revised budget vs. what we now expect to spend.
      // Positive = under budget, negative = projected overrun.
      const variance = totalRevised - forecastAtCompletion;

      const contractValue = project.contractValueAmount ? Number(project.contractValueAmount) : null;
      const marginAmount = contractValue !== null ? contractValue - forecastAtCompletion : null;
      const marginPct =
        contractValue !== null && contractValue !== 0
          ? Number(((marginAmount! / contractValue) * 100).toFixed(2))
          : null;

      return {
        projectId,
        budgetId: budget?.id ?? null,
        currency: budget?.currency ?? project.currency,
        originalTotal: toMoney(totalOriginal),
        revisedTotal: toMoney(totalRevised),
        committedTotal: toMoney(totalCommitted),
        actualTotal: toMoney(totalActual),
        costToComplete: toMoney(costToComplete),
        forecastAtCompletion: toMoney(forecastAtCompletion),
        variance: toMoney(variance),
        contractValueAmount: project.contractValueAmount,
        marginAmount: marginAmount !== null ? toMoney(marginAmount) : null,
        marginPct,
      };
    });
  }
}
