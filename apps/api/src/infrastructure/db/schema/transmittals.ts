import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { documentVersions } from "./documents";
import { projects } from "./projects";
import { users } from "./users";

// database.md §25 (FR-DOC-8). number is auto-assigned (max(number)+1 per
// project), same pattern as rfis.number.
export const transmittals = pgTable(
  "transmittals",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    purpose: text("purpose").notNull(),
    subject: text("subject").notNull(),
    message: text("message"),
    status: text("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: uuid("sent_by").references(() => users.id),
  },
  (table) => [
    check(
      "ck_transmittals_purpose",
      sql`${table.purpose} in ('for_review', 'for_approval', 'for_record', 'as_requested')`,
    ),
    check("ck_transmittals_status", sql`${table.status} in ('draft', 'sent')`),
    uniqueIndex("ux_transmittals_tenant_project_number").on(table.tenantId, table.projectId, table.number),
    index("ix_transmittals_tenant_project").on(table.tenantId, table.projectId),
  ],
);

// Points at an immutable document_version, not the mutable document — same
// "transmit a specific revision" precedent as drawing_set_sheets.
export const transmittalItems = pgTable(
  "transmittal_items",
  {
    ...tenantColumns(),
    transmittalId: uuid("transmittal_id")
      .notNull()
      .references(() => transmittals.id),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id),
    description: text("description"),
  },
  (table) => [index("ix_transmittal_items_transmittal").on(table.tenantId, table.transmittalId)],
);

// recipient_user_id is always a real users.id (internal staff or an
// external portal user already in company_users) — never a raw email
// address; there is no address book of non-users here.
export const transmittalRecipients = pgTable(
  "transmittal_recipients",
  {
    ...tenantColumns(),
    transmittalId: uuid("transmittal_id")
      .notNull()
      .references(() => transmittals.id),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ux_transmittal_recipients_tenant_transmittal_user").on(
      table.tenantId,
      table.transmittalId,
      table.recipientUserId,
    ),
    index("ix_transmittal_recipients_transmittal").on(table.tenantId, table.transmittalId),
  ],
);

// database.md §25 (FR-DOC-9). entity_type deliberately excludes
// 'submittal' — its reviewer is an external CRM contact, not a users.id
// (see this table's own doc comment in database.md for the full reasoning).
export const approvalMatrices = pgTable(
  "approval_matrices",
  {
    ...tenantColumns(),
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    check("ck_approval_matrices_entity_type", sql`${table.entityType} in ('document', 'transmittal')`),
    index("ix_approval_matrices_tenant_entity").on(table.tenantId, table.entityType),
  ],
);

// approver_user_id is a specific named person, never a role — "any user
// with role X" would make "who is the current approver" ambiguous.
export const approvalMatrixSteps = pgTable(
  "approval_matrix_steps",
  {
    ...tenantColumns(),
    approvalMatrixId: uuid("approval_matrix_id")
      .notNull()
      .references(() => approvalMatrices.id),
    stepOrder: integer("step_order").notNull(),
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id),
    label: text("label"),
  },
  (table) => [
    uniqueIndex("ux_approval_matrix_steps_tenant_matrix_order").on(
      table.tenantId,
      table.approvalMatrixId,
      table.stepOrder,
    ),
    index("ix_approval_matrix_steps_matrix_order").on(table.tenantId, table.approvalMatrixId, table.stepOrder),
  ],
);

// One chain run against one entity. At most one in_progress instance per
// entity at a time (partial unique below) — same "one active X per Y"
// shape as budgets' one-active-budget-per-project.
export const approvalInstances = pgTable(
  "approval_instances",
  {
    ...tenantColumns(),
    approvalMatrixId: uuid("approval_matrix_id")
      .notNull()
      .references(() => approvalMatrices.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    status: text("status").notNull().default("in_progress"),
    currentStepOrder: integer("current_step_order").notNull(),
  },
  (table) => [
    check("ck_approval_instances_entity_type", sql`${table.entityType} in ('document', 'transmittal')`),
    check("ck_approval_instances_status", sql`${table.status} in ('in_progress', 'approved', 'rejected')`),
    uniqueIndex("ux_approval_instances_tenant_entity_in_progress")
      .on(table.tenantId, table.entityType, table.entityId)
      .where(sql`${table.status} = 'in_progress'`),
    index("ix_approval_instances_tenant_entity").on(table.tenantId, table.entityType, table.entityId),
  ],
);

// Append-only decision log (FR-DOC-9's entire guard-rail lives in the
// service, not this table): decide() only ever accepts a decision from the
// current step's named approver_user_id, and a rejected decision halts the
// chain immediately rather than continuing to evaluate later steps.
export const approvalInstanceDecisions = pgTable(
  "approval_instance_decisions",
  {
    ...tenantColumns(),
    approvalInstanceId: uuid("approval_instance_id")
      .notNull()
      .references(() => approvalInstances.id),
    stepOrder: integer("step_order").notNull(),
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id),
    decision: text("decision").notNull(),
    comments: text("comments"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_approval_instance_decisions_decision", sql`${table.decision} in ('approved', 'rejected')`),
    index("ix_approval_instance_decisions_instance").on(table.tenantId, table.approvalInstanceId, table.stepOrder),
  ],
);
