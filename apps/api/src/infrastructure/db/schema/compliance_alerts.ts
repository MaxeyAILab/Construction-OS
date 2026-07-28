import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { certifications } from "./safety";
import { companies } from "./companies";
import { subcontractors } from "./subcontractors";

// api.md §15.4 "Compliance Agent" (FR-SUB-2, FR-SAFE-2). An immutable
// alert log, same "audit_log-shaped, reject every mutation" precedent as
// finance_alerts — no tenantColumns() since nothing about a fired alert
// is ever supposed to change (a renewed certification's next read just
// stops reporting it as due; it doesn't retract this row). Rule-only,
// no AI enrichment this pass (unlike finance_alerts' optional causal
// explanation) — there's nothing to explain, just an expiry date.
export const complianceAlerts = pgTable(
  "compliance_alerts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    certificationId: uuid("certification_id")
      .notNull()
      .references(() => certifications.id),
    // Only subcontractor-held certifications are this agent's concern
    // ("sub compliance" per roadmap.md's dependency) — a user-held
    // certification is Safety's own concern, not chased here.
    subcontractorId: uuid("subcontractor_id")
      .notNull()
      .references(() => subcontractors.id),
    dueState: text("due_state").notNull(),
    expiresAt: date("expires_at").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_compliance_alerts_due_state", sql`${table.dueState} in ('expiring_soon', 'expired')`),
    index("ix_compliance_alerts_tenant_created").on(table.tenantId, table.createdAt.desc()),
    // One alert per (certification, due_state) transition — a still-
    // expiring cert doesn't re-fire on every daily tick.
    uniqueIndex("ux_compliance_alerts_certification_due_state").on(table.certificationId, table.dueState),
  ],
);
