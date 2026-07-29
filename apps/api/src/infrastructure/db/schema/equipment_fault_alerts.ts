import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { aiRuns } from "./ai";
import { companies } from "./companies";
import { equipment, equipmentInspections } from "./equipment";

// ai-spec.md §7.6 (Equipment AI, M11) / FR-EQ-4 "fault patterns" — the one
// capability equipment-insights.service.ts's own doc comment flagged as
// deferred, not invented. Unlike finance_alerts' rule-computes-fact/AI-
// narrates split (a margin breach is real regardless of whether the AI
// call to explain it succeeds), whether a set of failed inspections is a
// genuine *recurring* fault (same component, worsening) rather than
// coincidental unrelated failures is itself a judgment call only the model
// makes by reading the notes — so there is no rule-only fallback row here.
// No AI run -> no alert, same "never invent a cause the data doesn't
// support" discipline as MarginErosionService's prompt. An immutable
// alert log, same "audit_log-shaped, reject every mutation" precedent as
// compliance_alerts/finance_alerts — no tenantColumns() since nothing
// about a fired alert is ever supposed to change (a newly failed
// inspection produces a new row, not an edit to this one).
export const equipmentFaultAlerts = pgTable(
  "equipment_fault_alerts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id),
    failedInspectionCount: integer("failed_inspection_count").notNull(),
    windowDays: integer("window_days").notNull(),
    description: text("description").notNull(),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id),
    // The most recent failed inspection that fed this alert — doubles as
    // the dedup key (see the unique index below): re-processing the same
    // inspection.created event never double-fires, but a subsequent new
    // failure re-evaluating the same equipment can fire again.
    latestInspectionId: uuid("latest_inspection_id")
      .notNull()
      .references(() => equipmentInspections.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_equipment_fault_alerts_tenant_created").on(table.tenantId, table.createdAt.desc()),
    uniqueIndex("ux_equipment_fault_alerts_equipment_latest_inspection").on(table.equipmentId, table.latestInspectionId),
  ],
);
