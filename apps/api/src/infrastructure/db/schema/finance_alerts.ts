import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { aiRuns } from "./ai";
import { companies } from "./companies";
import { projects } from "./projects";

// FR-FIN-6 (database.md §11 finance domain, ai-spec.md §7.10 Financial
// AI). An immutable alert log, same "audit_log-shaped, reject every
// mutation" precedent as ai_messages/audit_log — no tenantColumns() since
// nothing about a fired alert is ever supposed to change (a recovered or
// worsened margin produces a new row, not an edit to this one).
export const financeAlerts = pgTable(
  "finance_alerts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    // Only 'margin_erosion' fires this pass — the "anomaly feed" half of
    // api.md §10's `GET /finance/alerts` (invoice anomaly detection,
    // ai-spec §7.10) has no producer yet. Flagged, not silently dropped.
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    marginPct: numeric("margin_pct", { precision: 6, scale: 2 }).notNull(),
    thresholdPct: numeric("threshold_pct", { precision: 6, scale: 2 }).notNull(),
    // AI causal decomposition (ai-spec §7.10: "labor overrun vs material
    // price vs scope creep") — a best-effort enrichment, never a
    // precondition for the alert firing (see MarginErosionService: the
    // rule always persists the alert even if the AI explanation call
    // fails or the tenant's AI budget is exhausted).
    explanation: text("explanation"),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_finance_alerts_kind", sql`${table.kind} in ('margin_erosion')`),
    check("ck_finance_alerts_severity", sql`${table.severity} in ('warning', 'critical')`),
    index("ix_finance_alerts_tenant_project_created").on(table.tenantId, table.projectId, table.createdAt.desc()),
  ],
);
