import { sql } from "drizzle-orm";
import { check, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { costCodes, projects } from "./projects";
import { users } from "./users";

// database.md §15 (M8). "One per project/day/author": ux(tenant_id,
// project_id, report_date, created_by) — a crew lead filing a second
// report for the same day is a distinct author, not an edit conflict.
// Offline-first: created on device with a client-generated UUIDv7
// (architecture.md §14.2), same explicitId convention as tasks.create.
export const dailyReports = pgTable(
  "daily_reports",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    reportDate: date("report_date").notNull(),
    // Shape is a documented assumption — database.md says "weather jsonb
    // (auto-filled + editable)" without specifying the shape or the
    // auto-fill source. No weather API is wired up in this pass (same
    // "flagged, not built" treatment as the QuickBooks credential gap):
    // the field is manually entered/edited only until a provider + API
    // key exist.
    weather: jsonb("weather"),
    narrative: text("narrative"),
    status: text("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    aiSummary: text("ai_summary"),
  },
  (table) => [
    uniqueIndex("ux_daily_reports_tenant_project_date_author").on(
      table.tenantId,
      table.projectId,
      table.reportDate,
      table.createdBy,
    ),
    check("ck_daily_reports_status", sql`${table.status} in ('draft', 'submitted')`),
  ],
);

// database.md §15: "Append-only ... Approval -> cost_transactions at labor
// rate (FR-FIELD-2)." No update after creation via the API — corrections
// are a new entry, matching the append-only ledger pattern cost_transactions
// itself already uses.
export const timeEntries = pgTable(
  "time_entries",
  {
    ...tenantColumns(),
    dailyReportId: uuid("daily_report_id").references(() => dailyReports.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    userId: uuid("user_id").references(() => users.id),
    crewLabel: text("crew_label"),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    workDate: date("work_date").notNull(),
    kind: text("kind").notNull().default("regular"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    costTransactionId: uuid("cost_transaction_id"),
  },
  (table) => [
    check("ck_time_entries_kind", sql`${table.kind} in ('regular', 'overtime')`),
    check(
      "ck_time_entries_worker",
      sql`${table.userId} is not null or ${table.crewLabel} is not null`,
    ),
    index("ix_time_tenant_user_date").on(table.tenantId, table.userId, table.workDate),
    index("ix_time_project_date").on(table.projectId, table.workDate),
  ],
);
