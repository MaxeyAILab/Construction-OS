import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { costCodes, projects } from "./projects";

// database.md §14: "One active + baselines per project." No explicit
// "create schedule" endpoint exists in api.md §6 — the master schedule is
// lazily get-or-created on first `GET /projects/{id}/schedule`
// (SchedulesService.getActiveSchedule), matching this table's "one per
// project" framing without inventing an undocumented endpoint.
export const schedules = pgTable(
  "schedules",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").notNull().default("master"),
    // Self-FK for baselines: baselineOfId points back at the master this
    // was snapshotted from. 'lookahead' kind is part of database.md's own
    // documented CHECK constraint, kept here even though the Lookahead
    // roadmap row (FR-SCH-3) that would create/populate one is out of
    // scope for this pass (flagged follow-up).
    baselineOfId: uuid("baseline_of_id").references((): AnyPgColumn => schedules.id),
    name: text("name"),
    dataDate: date("data_date").notNull(),
    // Application-managed monotonic counter — distinct from tenantColumns'
    // per-row updated_seq (which only bumps when this `schedules` row
    // itself changes). Every activity/dependency mutation and every
    // recalculate bumps this instead, so `GET .../schedule`'s ETag
    // (api.md §6: "ETag-cached by schedule_version") reflects the whole
    // schedule's content, not just the header row.
    scheduleVersion: integer("schedule_version").notNull().default(0),
  },
  (table) => [
    check("ck_schedules_kind", sql`${table.kind} in ('master', 'baseline', 'lookahead')`),
    index("ix_schedules_project_kind").on(table.projectId, table.kind),
  ],
);

export const scheduleActivities = pgTable(
  "schedule_activities",
  {
    ...tenantColumns(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id),
    wbsPath: text("wbs_path"),
    name: text("name").notNull(),
    durationDays: integer("duration_days").notNull().default(0),
    // Computed by the CPM engine (RecalculateService), not user-supplied —
    // null until the first recalculate() run.
    startDate: date("start_date"),
    endDate: date("end_date"),
    actualStartDate: date("actual_start_date"),
    actualEndDate: date("actual_end_date"),
    percentComplete: numeric("percent_complete", { precision: 5, scale: 2 }).notNull().default("0.00"),
    isMilestone: boolean("is_milestone").notNull().default(false),
    isCritical: boolean("is_critical").notNull().default(false),
    totalFloatDays: integer("total_float_days"),
    crew: jsonb("crew"),
    costCodeId: uuid("cost_code_id").references(() => costCodes.id),
    // Set only on baseline-schedule activities: the master activity this
    // one was snapshotted from (POST .../baselines). Lets a client diff
    // planned-vs-baseline dates (FR-SCH-2 "track variance") without
    // matching on fragile fields like name/wbs_path. No dedicated
    // variance-report endpoint is built this pass — api.md doesn't
    // document one; this column just makes the comparison possible once
    // one's needed (e.g. from the /summary aggregate, FR-PM-3).
    baselineSourceActivityId: uuid("baseline_source_activity_id").references(
      (): AnyPgColumn => scheduleActivities.id,
    ),
    // No calendar_id: database.md §14 lists one on this table, but no
    // `calendars` entity (working days/holidays) is defined anywhere in
    // the specs (checked database.md/architecture.md/spec.md/ai-spec.md).
    // v1's CPM engine treats every day as a working day — flagged
    // follow-up alongside resource_assignments/lookahead (roadmap's own
    // "CPM scope discipline" risk note).
  },
  (table) => [
    check("ck_schedule_activities_duration", sql`${table.durationDays} >= 0`),
    check(
      "ck_schedule_activities_percent",
      sql`${table.percentComplete} >= 0 and ${table.percentComplete} <= 100`,
    ),
    index("ix_activities_schedule_start").on(table.scheduleId, table.startDate),
    // FR-SCH-5 (cross-project resource views) — the index earns its keep
    // once /resources/conflicts (deferred to the Lookahead/resource-
    // conflicts roadmap row) is built; harmless to have now.
    index("ix_activities_tenant_dates").on(table.tenantId, table.startDate, table.endDate),
  ],
);

// database.md §14: "PK (predecessor_id, successor_id)" — translated to a
// uuid surrogate PK (tenantColumns(), the convention every table this
// session uses) plus a unique index enforcing that same natural-key
// uniqueness, the identical precedent used for project_users' composite
// natural key.
export const activityDependencies = pgTable(
  "activity_dependencies",
  {
    ...tenantColumns(),
    predecessorId: uuid("predecessor_id")
      .notNull()
      .references(() => scheduleActivities.id),
    successorId: uuid("successor_id")
      .notNull()
      .references(() => scheduleActivities.id),
    type: text("type").notNull().default("FS"),
    lagDays: integer("lag_days").notNull().default(0),
  },
  (table) => [
    check("ck_activity_dependencies_type", sql`${table.type} in ('FS', 'SS', 'FF', 'SF')`),
    uniqueIndex("ux_activity_dependencies_pair").on(table.predecessorId, table.successorId),
    index("ix_activity_dependencies_successor").on(table.successorId),
  ],
);
