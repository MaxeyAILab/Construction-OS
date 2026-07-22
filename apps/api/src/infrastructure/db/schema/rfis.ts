import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { documentVersions } from "./documents";
import { projects } from "./projects";

// database.md §16 (M3), roadmap.md "RFIs v1" (submittals are a separate
// Phase 2 row — spec.md FR-DOC-4 groups them, but roadmap.md's own build
// order splits them). number is auto-assigned per project (max+1), same
// convention as change_orders.number.
export const rfis = pgTable(
  "rfis",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    subject: text("subject").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    status: text("status").notNull().default("draft"),
    // "external A/E" — no FK yet: CRM/contacts (M1) is a Phase 2 row, not
    // built — same "flag it" precedent as projects.clientContactCompanyId.
    assignedToContactId: uuid("assigned_to_contact_id"),
    dueDate: date("due_date"),
    costImpactFlag: boolean("cost_impact_flag").notNull().default(false),
    scheduleImpactFlag: boolean("schedule_impact_flag").notNull().default(false),
    // No FK yet: Scheduling v1 (M7) hasn't been built yet either, even
    // though it's a later row in this same Phase 1B pass.
    linkedActivityId: uuid("linked_activity_id"),
    // Real FK, unlike the two placeholders above — the Documents module
    // (M3) already exists, so this can be a genuine reference to the
    // specific drawing version the RFI is about.
    linkedDrawingRef: uuid("linked_drawing_ref").references(() => documentVersions.id),
  },
  (table) => [
    check(
      "ck_rfis_status",
      sql`${table.status} in ('draft', 'open', 'answered', 'closed', 'void')`,
    ),
    uniqueIndex("ux_rfis_tenant_project_number").on(table.tenantId, table.projectId, table.number),
    index("ix_rfis_project_status").on(table.projectId, table.status),
  ],
);
