import { Inject, Injectable } from "@nestjs/common";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  budgetLines,
  budgets,
  projectionCompanyKpis,
  projectionProjectFinancials,
  projects,
} from "../../../infrastructure/db/schema";

function sum(values: string[]): number {
  return values.reduce((total, v) => total + Number(v), 0);
}

function toMoney(n: number): string {
  return n.toFixed(2);
}

// Events that change a project's budget rollup — each recomputes that
// project's projection_project_financials row from source (same fields
// FinancialSummaryService.get() computes live for FR-FIN-3), then the
// tenant's projection_company_kpis row.
const FINANCIAL_EVENT_TYPES = new Set<string>([
  "budget.created.v1",
  "budget_line.created.v1",
  "budget_line.updated.v1",
  "cost_transaction.posted.v1",
]);

// Events that change project counts (but not any project's financials
// directly) — only the company rollup needs recomputing.
const PROJECT_EVENT_TYPES = new Set<string>([
  "project.created.v1",
  "project.updated.v1",
  "project.deleted.v1",
]);

// M16 Executive Dashboard v1 (FR-EXEC-1, database.md §21: "projection_*
// tables... rebuilt from events; disposable by design; never a source of
// truth"). Every handled event re-derives the affected row(s) wholesale
// from the live source tables and upserts — a plain recompute-and-replace,
// which is what makes this consumer trivially idempotent under
// at-least-once delivery (same reasoning AuditWriterService relies on for
// its own upsert-free but equally re-derivable writes).
@Injectable()
export class DashboardProjectionsWriterService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async handleEnvelope(envelope: OutboxEnvelope): Promise<void> {
    const payload = envelope.payload as Record<string, unknown>;

    if (FINANCIAL_EVENT_TYPES.has(envelope.eventType)) {
      const projectId = payload.projectId as string;
      await this.upsertProjectFinancials(envelope.tenantId, projectId);
      await this.upsertCompanyKpis(envelope.tenantId);
      return;
    }

    if (PROJECT_EVENT_TYPES.has(envelope.eventType)) {
      await this.upsertCompanyKpis(envelope.tenantId);
      return;
    }

    // no projection mapping for this event type — not an error, same as
    // AuditWriterService's mapToAuditEntry returning null.
  }

  private async upsertProjectFinancials(tenantId: string, projectId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      // project.deleted.v1 (or a race with it) means there's nothing left
      // to project — leave any existing row as the last-known state rather
      // than guessing at zeros.
      if (!project) return;

      const budget = await tx.query.budgets.findFirst({
        where: and(eq(budgets.projectId, projectId), eq(budgets.status, "active")),
      });
      const lines = budget
        ? await tx.query.budgetLines.findMany({ where: eq(budgetLines.budgetId, budget.id) })
        : [];

      const originalTotal = sum(lines.map((l) => l.originalAmount));
      const revisedTotal = sum(lines.map((l) => l.revisedAmount ?? "0"));
      const committedTotal = sum(lines.map((l) => l.committedAmount));
      const actualTotal = sum(lines.map((l) => l.actualAmount));
      const costToComplete = sum(lines.map((l) => l.forecastToCompleteAmount));
      const forecastAtCompletion = sum(lines.map((l) => l.forecastAtCompletionAmount));

      const contractValue = project.contractValueAmount ? Number(project.contractValueAmount) : null;
      const marginAmount = contractValue !== null ? contractValue - forecastAtCompletion : null;
      const marginPct =
        contractValue !== null && contractValue !== 0
          ? Number(((marginAmount! / contractValue) * 100).toFixed(2))
          : null;

      const row = {
        tenantId,
        projectId,
        currency: budget?.currency ?? project.currency,
        originalTotalAmount: toMoney(originalTotal),
        revisedTotalAmount: toMoney(revisedTotal),
        committedTotalAmount: toMoney(committedTotal),
        actualTotalAmount: toMoney(actualTotal),
        costToCompleteAmount: toMoney(costToComplete),
        forecastAtCompletionAmount: toMoney(forecastAtCompletion),
        marginAmount: marginAmount !== null ? toMoney(marginAmount) : null,
        marginPct: marginPct !== null ? marginPct.toFixed(2) : null,
        updatedAt: new Date(),
      };

      await tx
        .insert(projectionProjectFinancials)
        .values(row)
        .onConflictDoUpdate({
          target: [projectionProjectFinancials.tenantId, projectionProjectFinancials.projectId],
          set: row,
        });
    });
  }

  private async upsertCompanyKpis(tenantId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const [projectStats] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${projects.status} = 'active')::int`,
        })
        .from(projects)
        .where(and(eq(projects.tenantId, tenantId), isNull(projects.deletedAt)));

      const financials = await tx.query.projectionProjectFinancials.findMany({
        where: eq(projectionProjectFinancials.tenantId, tenantId),
      });

      const totalRevised = sum(financials.map((f) => f.revisedTotalAmount));
      const totalActual = sum(financials.map((f) => f.actualTotalAmount));
      const totalForecast = sum(financials.map((f) => f.forecastAtCompletionAmount));
      const marginRows = financials.filter((f) => f.marginAmount !== null);
      const totalMargin = marginRows.length > 0 ? sum(marginRows.map((f) => f.marginAmount!)) : null;

      const row = {
        tenantId,
        projectCount: projectStats?.total ?? 0,
        activeProjectCount: projectStats?.active ?? 0,
        totalRevisedAmount: toMoney(totalRevised),
        totalActualAmount: toMoney(totalActual),
        totalForecastAtCompletionAmount: toMoney(totalForecast),
        totalMarginAmount: totalMargin !== null ? toMoney(totalMargin) : null,
        updatedAt: new Date(),
      };

      await tx
        .insert(projectionCompanyKpis)
        .values(row)
        .onConflictDoUpdate({
          target: projectionCompanyKpis.tenantId,
          set: row,
        });
    });
  }
}
