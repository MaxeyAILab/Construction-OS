import { sql } from "drizzle-orm";
import {
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
import { users } from "./users";

// database.md §9 (M4): "phases, cost codes (WBS), teams, milestones" plus
// templates (FR-PM-4). `projectTemplates` is declared first since
// `projects.templateId` references it.
export const projectTemplates = pgTable("project_templates", {
  ...tenantColumns(),
  name: text("name").notNull(),
  description: text("description"),
  // "phases, cost codes, checklists, folder skeleton" applied at creation
  // (database.md §9) — folder skeleton/checklists have no consuming module
  // yet (Documents M3, Tasks M6 — both Phase 1B, not built), so those keys
  // are simply ignored by applyTemplate() today until those modules exist
  // to interpret them.
  manifest: jsonb("manifest").notNull().default({}),
});

// database.md §9: "the central aggregate every module attaches to."
export const projects = pgTable(
  "projects",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: text("status").notNull().default("planning"),
    // No FK: the CRM module (M1) that owns client/contact companies
    // doesn't exist yet — same "flag it, add the reference once the
    // module lands" precedent as audit_log.ai_run_id.
    clientContactCompanyId: uuid("client_contact_company_id"),
    address: text("address"),
    // jsonb {lat, lng} rather than Postgres' native `point` type, which
    // drizzle-orm's pg-core doesn't expose a typed column builder for —
    // revisit as a native geo type if geospatial queries are ever needed.
    geo: jsonb("geo"),
    startDate: date("start_date"),
    targetEndDate: date("target_end_date"),
    actualEndDate: date("actual_end_date"),
    contractValueAmount: numeric("contract_value_amount", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    // FR-PM-2's computed subscores — {schedule, budget, safety, quality,
    // overall}, all null until Schedule (M7)/Finance (M9)/Safety exist to
    // feed them. Structure is real; the computation is stubbed (see
    // ProjectsService.STUB_HEALTH and the /summary endpoint).
    health: jsonb("health"),
    templateId: uuid("template_id").references(() => projectTemplates.id),
    settings: jsonb("settings").notNull().default({}),
  },
  (table) => [
    check(
      "ck_projects_status",
      sql`${table.status} in ('planning', 'active', 'on_hold', 'closed', 'warranty')`,
    ),
    uniqueIndex("ux_projects_tenant_code").on(table.tenantId, table.code),
    index("ix_projects_tenant_status").on(table.tenantId, table.status),
    index("ix_projects_name_trgm").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

// database.md §9: adjacency-list WBS tree, depth <= 4 in practice.
export const costCodes = pgTable(
  "cost_codes",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    division: text("division"),
    parentId: uuid("parent_id"),
    kind: text("kind").notNull(),
  },
  (table) => [
    check(
      "ck_cost_codes_kind",
      sql`${table.kind} in ('labor', 'material', 'equipment', 'subcontract', 'other')`,
    ),
    uniqueIndex("ux_cost_codes_tenant_project_code").on(
      table.tenantId,
      table.projectId,
      table.code,
    ),
    index("ix_cost_codes_project_parent").on(table.projectId, table.parentId),
  ],
);

// database.md §9: "Membership + field-working-set driver (sync scope,
// architecture §14.2)." Deliberately separate from RBAC's `user_roles`
// (scope_type='project') — this is team roster, not permission grants.
export const projectUsers = pgTable(
  "project_users",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [uniqueIndex("ux_project_users").on(table.tenantId, table.projectId, table.userId)],
);

export const milestones = pgTable(
  "milestones",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("ix_milestones_project").on(table.projectId)],
);
