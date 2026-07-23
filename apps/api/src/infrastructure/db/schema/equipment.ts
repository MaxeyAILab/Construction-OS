import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { costCodes, projects } from "./projects";
import { users } from "./users";

// database.md §13 (M11): "Registry: asset_no (ux tenant), name, category,
// make/model/serial, ownership CHECK IN ('owned','rented','leased'),
// hourly_cost_rate_amount, daily_cost_rate_amount, status CHECK IN
// ('available','assigned','maintenance','retired'), current_project_id
// NULL, telematics jsonb NULL (GPS roadmap)." telematics stays unwritten
// until a GPS/IoT integration exists — not built this pass, same "the
// doc's own roadmap parenthetical" precedent as ai_conversations' voice
// fields.
export const equipment = pgTable(
  "equipment",
  {
    ...tenantColumns(),
    assetNo: text("asset_no").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    make: text("make"),
    model: text("model"),
    serialNumber: text("serial_number"),
    ownership: text("ownership").notNull().default("owned"),
    hourlyCostRateAmount: numeric("hourly_cost_rate_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    dailyCostRateAmount: numeric("daily_cost_rate_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    status: text("status").notNull().default("available"),
    currentProjectId: uuid("current_project_id").references(() => projects.id),
    telematics: jsonb("telematics"),
  },
  (table) => [
    check("ck_equipment_ownership", sql`${table.ownership} in ('owned', 'rented', 'leased')`),
    check("ck_equipment_status", sql`${table.status} in ('available', 'assigned', 'maintenance', 'retired')`),
    uniqueIndex("ux_equipment_tenant_asset_no").on(table.tenantId, table.assetNo),
  ],
);

// database.md §13: "equipment_id, project_id, start_at, end_at NULL,
// assigned_by. Exclusion constraint (EXCLUDE USING gist on equipment_id +
// tstzrange) prevents double-assignment — DB-level guarantee (FR-EQ-1)."
// The EXCLUDE constraint itself can't be expressed through drizzle's
// schema builder (no declarative API for it) — hand-written in this
// migration's rls_and_triggers companion, same "hand-write what drizzle
// can't declare" precedent as RLS policies/triggers everywhere else this
// session. Requires the btree_gist extension for a uuid equality
// operator class inside a gist index.
export const equipmentAssignments = pgTable(
  "equipment_assignments",
  {
    ...tenantColumns(),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    assignedBy: uuid("assigned_by").references(() => users.id),
  },
  (table) => [index("ix_equipment_assignments_equipment").on(table.equipmentId, table.startAt)],
);

// database.md §13: "Append-only: hours/odometer per day (field-captured),
// operator_id -> generates cost_transactions at the equipment rate
// (FR-EQ-2)." No approval gate is documented here (unlike time_entries'
// explicit "Approval -> cost_transactions") — posts on creation.
// project_id/cost_code_id stay nullable: equipment can log hours against
// general/overhead use with nothing to cost yet.
export const equipmentUsageLogs = pgTable(
  "equipment_usage_logs",
  {
    ...tenantColumns(),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id),
    projectId: uuid("project_id").references(() => projects.id),
    costCodeId: uuid("cost_code_id").references(() => costCodes.id),
    operatorId: uuid("operator_id").references(() => users.id),
    workDate: date("work_date").notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }),
    odometer: numeric("odometer", { precision: 10, scale: 2 }),
  },
  (table) => [index("ix_equipment_usage_logs_equipment_date").on(table.equipmentId, table.workDate)],
);

// database.md §13: "Recurrence rules (every N hours/days), due-state
// projection feeds reminders (FR-EQ-3)." The due-state itself (due-soon/
// overdue) is computed on read from last_service_*/recurrence_value —
// same "no reconciliation job, plain read is always exact" reasoning as
// budget_lines' live-margin view — not a stored/maintained column.
export const maintenanceSchedules = pgTable(
  "maintenance_schedules",
  {
    ...tenantColumns(),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id),
    name: text("name").notNull(),
    recurrenceType: text("recurrence_type").notNull(),
    recurrenceValue: integer("recurrence_value").notNull(),
    lastServiceDate: date("last_service_date"),
    lastServiceHours: numeric("last_service_hours", { precision: 10, scale: 2 }),
  },
  (table) => [
    check("ck_maintenance_schedules_recurrence_type", sql`${table.recurrenceType} in ('hours', 'days')`),
    index("ix_maintenance_schedules_equipment").on(table.equipmentId),
  ],
);

// database.md §13: "work orders track cost (parts/labor) to overhead or
// project." parts_cost_amount/labor_cost_amount are informational fields
// only — FR-EQ-3 doesn't call for auto-posting them to cost_transactions
// the way FR-EQ-2 explicitly does for usage logs, so no job-costing
// integration is wired here (flagged, not invented).
export const maintenanceWorkOrders = pgTable(
  "maintenance_work_orders",
  {
    ...tenantColumns(),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id),
    maintenanceScheduleId: uuid("maintenance_schedule_id").references(() => maintenanceSchedules.id),
    status: text("status").notNull().default("open"),
    description: text("description"),
    costAllocation: text("cost_allocation").notNull().default("overhead"),
    projectId: uuid("project_id").references(() => projects.id),
    costCodeId: uuid("cost_code_id").references(() => costCodes.id),
    partsCostAmount: numeric("parts_cost_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    laborCostAmount: numeric("labor_cost_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check("ck_maintenance_work_orders_status", sql`${table.status} in ('open', 'in_progress', 'completed', 'cancelled')`),
    check("ck_maintenance_work_orders_cost_allocation", sql`${table.costAllocation} in ('overhead', 'project')`),
    index("ix_maintenance_work_orders_equipment").on(table.equipmentId),
  ],
);

export const equipmentInspections = pgTable(
  "equipment_inspections",
  {
    ...tenantColumns(),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id),
    inspectorId: uuid("inspector_id").references(() => users.id),
    inspectionDate: date("inspection_date").notNull(),
    checklist: jsonb("checklist"),
    passed: boolean("passed").notNull().default(true),
    notes: text("notes"),
  },
  (table) => [index("ix_equipment_inspections_equipment_date").on(table.equipmentId, table.inspectionDate)],
);
