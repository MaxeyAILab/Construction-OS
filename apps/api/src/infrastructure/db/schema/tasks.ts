import { sql } from "drizzle-orm";
import { check, date, index, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { documentVersions } from "./documents";
import { projects } from "./projects";
import { rfis } from "./rfis";
import { users } from "./users";

// database.md §15 (M6/M8/M12 section — this table covers M6 only; M8/M12's
// daily_reports/time_entries/photos/field_issues/safety_* are later
// roadmap rows, not built here). "Punch items are kind='punch' — same
// table, shared machinery (FR-TASK-2), differentiated UX."
export const tasks = pgTable(
  "tasks",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    // database.md doesn't enumerate priority's values — low/medium/high/
    // urgent is a documented assumption, same treatment as estimates'
    // markup-cascade formula earlier this session.
    priority: text("priority").notNull().default("medium"),
    dueDate: date("due_date"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    kind: text("kind").notNull().default("task"),
    // "location_ref (drawing pin: document_version_id + x/y)" — structured
    // columns rather than jsonb since the shape is fully known; a real FK
    // now that Documents exists.
    locationDocumentVersionId: uuid("location_document_version_id").references(() => documentVersions.id),
    locationX: numeric("location_x", { precision: 7, scale: 4 }),
    locationY: numeric("location_y", { precision: 7, scale: 4 }),
    // No FK yet: Scheduling v1 (M7) is a later roadmap row.
    scheduleActivityId: uuid("schedule_activity_id"),
    // Real FK, unlike scheduleActivityId — RFIs (M3) already exists.
    rfiId: uuid("rfi_id").references(() => rfis.id),
    checklist: jsonb("checklist"),
  },
  (table) => [
    check(
      "ck_tasks_status",
      sql`${table.status} in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')`,
    ),
    check("ck_tasks_priority", sql`${table.priority} in ('low', 'medium', 'high', 'urgent')`),
    check("ck_tasks_kind", sql`${table.kind} in ('task', 'punch')`),
    index("ix_tasks_tenant_assignee_status_due").on(table.tenantId, table.assigneeId, table.status, table.dueDate),
    index("ix_tasks_project_status").on(table.projectId, table.status),
  ],
);
