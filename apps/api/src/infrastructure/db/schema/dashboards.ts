import { sql } from "drizzle-orm";
import { integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { projects } from "./projects";

// M16 Executive Dashboard v1 (FR-EXEC-1, database.md §21). These are
// "projection_*" read models — "rebuilt from events; disposable by design;
// never a source of truth" — so unlike every other table this session they
// deliberately skip tenantColumns()' full standard-column set (no
// created_by/updated_by/deleted_at/updated_seq: nobody "creates" or
// "soft-deletes" a projection row, it's just upserted wholesale from the
// live source tables whenever a relevant event lands). Same kind of
// deviation-with-comment as job_runs' own lighter column set. tenant_id +
// RLS still apply — multi-tenancy is non-negotiable regardless of a
// table's disposability.

// One row per project: the budget rollup database.md §21 names by name
// (revised budget, committed, actual, forecast, margin %). Recomputed
// from budgets/budget_lines (the same fields FinancialSummaryService
// computes live for a single project's FR-FIN-3 view) and upserted
// whenever a budget.*/budget_line.*/cost_transaction.* event lands for
// that project — see dashboard-projections-consumer.worker.ts. Existing
// live-per-project reads keep using FinancialSummaryService directly
// (database.md §11: "no reconciliation job" for that single-project
// case); this table exists so the company-wide dashboard can sum across
// every project without re-summing every budget line on every request.
export const projectionProjectFinancials = pgTable(
  "projection_project_financials",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    currency: text("currency").notNull().default("USD"),
    originalTotalAmount: numeric("original_total_amount", { precision: 14, scale: 2 }).notNull(),
    revisedTotalAmount: numeric("revised_total_amount", { precision: 14, scale: 2 }).notNull(),
    committedTotalAmount: numeric("committed_total_amount", { precision: 14, scale: 2 }).notNull(),
    actualTotalAmount: numeric("actual_total_amount", { precision: 14, scale: 2 }).notNull(),
    costToCompleteAmount: numeric("cost_to_complete_amount", { precision: 14, scale: 2 }).notNull(),
    forecastAtCompletionAmount: numeric("forecast_at_completion_amount", { precision: 14, scale: 2 }).notNull(),
    // Nullable: only known when the project carries a contract value
    // (ProjectSummaryService/FinancialSummaryService share this nullability).
    marginAmount: numeric("margin_amount", { precision: 14, scale: 2 }),
    marginPct: numeric("margin_pct", { precision: 7, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_projection_project_financials_tenant_project").on(table.tenantId, table.projectId)],
);

// One row per tenant: the portfolio rollup for GET /dashboards/company.
// database.md §21 names this "daily snapshot per tenant: pipeline value,
// WIP, cash position, overdue AR, safety TRIR" — built here as an
// event-maintained live row instead of a cron'd daily snapshot, since (a)
// pipeline/cash/safetyTrir are structurally unbuildable today (no CRM/M1,
// no AR-AP/invoicing, no Safety/M10 — flagged below, same "flag it, don't
// invent" treatment as every other cross-module gap this session) and (b)
// the fields that ARE real (the profitability rollup) need to be live for
// NFR-4 anyway, so a cron cadence would only add staleness with no
// accuracy benefit at today's data volume. Revisit if/when a real snapshot
// cadence is needed for cost reasons.
export const projectionCompanyKpis = pgTable(
  "projection_company_kpis",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    projectCount: integer("project_count").notNull().default(0),
    activeProjectCount: integer("active_project_count").notNull().default(0),
    totalRevisedAmount: numeric("total_revised_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    totalActualAmount: numeric("total_actual_amount", { precision: 16, scale: 2 }).notNull().default("0"),
    totalForecastAtCompletionAmount: numeric("total_forecast_at_completion_amount", {
      precision: 16,
      scale: 2,
    })
      .notNull()
      .default("0"),
    totalMarginAmount: numeric("total_margin_amount", { precision: 16, scale: 2 }),
    // Blocked — no CRM (M1)/AP-AR-invoicing/Safety (M10) module exists this
    // session to source these from. Columns kept (well-shaped, database.md
    // §21's own field list) so a future module lands into a ready slot,
    // same "STUB_HEALTH" precedent as projects.health.
    pipelineValueAmount: numeric("pipeline_value_amount", { precision: 16, scale: 2 }),
    cashPositionAmount: numeric("cash_position_amount", { precision: 16, scale: 2 }),
    overdueArAmount: numeric("overdue_ar_amount", { precision: 16, scale: 2 }),
    safetyTrir: numeric("safety_trir", { precision: 7, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ux_projection_company_kpis_tenant").on(table.tenantId)],
);
