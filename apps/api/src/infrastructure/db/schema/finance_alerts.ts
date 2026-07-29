import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { aiRuns } from "./ai";
import { companies } from "./companies";
import { invoices } from "./budgets";
import { projects } from "./projects";

// FR-FIN-6 (database.md §11 finance domain, ai-spec.md §7.10 Financial
// AI). An immutable alert log, same "audit_log-shaped, reject every
// mutation" precedent as ai_messages/audit_log — no tenantColumns() since
// nothing about a fired alert is ever supposed to change (a recovered or
// worsened margin produces a new row, not an edit to this one).
//
// One physical table backing two logical alert kinds (api.md §10's single
// `GET /finance/alerts` "margin-erosion & anomaly feed" contract, written
// before invoice_duplicate had a producer — the kind-specific columns
// below are nullable rather than splitting into a second table, so that
// contract stays a single feed instead of an app-layer merge of two
// tables). FinanceAlertsQueryService maps each row to a discriminated
// union by `kind`, never returning the other kind's null columns.
export const financeAlerts = pgTable(
  "finance_alerts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    // Nullable: invoice_duplicate alerts aren't always project-scoped (an
    // invoice's own project_id is nullable — company-level/overhead
    // invoices have none).
    projectId: uuid("project_id").references(() => projects.id),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    // margin_erosion-only columns (null for invoice_duplicate).
    marginPct: numeric("margin_pct", { precision: 6, scale: 2 }),
    thresholdPct: numeric("threshold_pct", { precision: 6, scale: 2 }),
    // AI causal decomposition (ai-spec §7.10: "labor overrun vs material
    // price vs scope creep") — a best-effort enrichment, never a
    // precondition for the alert firing (see MarginErosionService: the
    // rule always persists the alert even if the AI explanation call
    // fails or the tenant's AI budget is exhausted).
    explanation: text("explanation"),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id),
    // invoice_duplicate-only columns (null for margin_erosion). Rule-only,
    // no AI enrichment — same "nothing to explain beyond the match itself"
    // precedent as compliance_alerts.
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    duplicateOfInvoiceId: uuid("duplicate_of_invoice_id").references(() => invoices.id),
    matchReason: text("match_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_finance_alerts_kind", sql`${table.kind} in ('margin_erosion', 'invoice_duplicate')`),
    check("ck_finance_alerts_severity", sql`${table.severity} in ('warning', 'critical')`),
    check("ck_finance_alerts_match_reason", sql`${table.matchReason} is null or ${table.matchReason} in ('external_ref', 'amount_and_date')`),
    index("ix_finance_alerts_tenant_project_created").on(table.tenantId, table.projectId, table.createdAt.desc()),
  ],
);
