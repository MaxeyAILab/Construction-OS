import { sql } from "drizzle-orm";
import { boolean, check, date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { projects } from "./projects";
import { tasks } from "./tasks";
import { users } from "./users";

// database.md §15 (M12): "safety_form_templates: tenant-configurable jsonb
// form schemas (toolbox talk, inspection checklists)." Tenant-wide, not
// project-scoped — a template is reused across every project.
export const safetyFormTemplates = pgTable(
  "safety_form_templates",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("toolbox_talk"),
    schema: jsonb("schema").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [check("ck_safety_form_templates_kind", sql`${table.kind} in ('toolbox_talk', 'inspection')`)],
);

// database.md §15: "safety_forms: filled instances (template_id,
// project_id, responses jsonb, signatures jsonb, offline-created)." Same
// offline-created / client-generated-id treatment as daily_reports (FR-
// SAFE-1, architecture.md §14.2) — see explicitId on the service's create().
export const safetyForms = pgTable(
  "safety_forms",
  {
    ...tenantColumns(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => safetyFormTemplates.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    responses: jsonb("responses").notNull().default({}),
    signatures: jsonb("signatures"),
  },
  (table) => [index("ix_safety_forms_project_created").on(table.projectId, table.createdAt)],
);

// database.md §15: "incidents: kind CHECK IN ('incident','near_miss',
// 'observation'), severity, occurred_at, location, people jsonb, status,
// corrective_action_task_id NULL (FR-SAFE-3), OSHA-recordable flag."
// - `description` isn't itemized in the compressed schema listing but is
//   the basic narrative every incident report needs (spec.md's "incident
//   reporting" core job) — added the same way tasks.priority's enum was a
//   documented assumption, not an invented requirement.
// - `severity`'s values aren't enumerated in the docs either; low/medium/
//   high/critical is a standard incident-severity scale, same "documented
//   assumption" treatment as tasks.priority.
// - `status` is kept to a plain open/closed pair — corrective_action_
//   task_id being non-null is what signals "routed to a corrective
//   action" (FR-SAFE-3), so a third status value would be redundant state.
// - `corrective_action_task_id` is a real FK into Tasks (M6, already
//   built) — spec.md §M12 "Integrations: incidents route to Tasks and
//   management." "Management notification" is served as a pull-based
//   feed (GET /projects/{id}/incidents, filterable by severity/status)
//   rather than a push fan-out — no "who is this project's safety
//   manager" concept exists yet to address a push notification to, same
//   resolution FR-FIN-6/margin-erosion alerts already used for an
//   identical "notify management" phrase.
export const incidents = pgTable(
  "incidents",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").notNull().default("incident"),
    severity: text("severity").notNull().default("low"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    location: text("location"),
    description: text("description"),
    people: jsonb("people"),
    status: text("status").notNull().default("open"),
    correctiveActionTaskId: uuid("corrective_action_task_id").references(() => tasks.id),
    oshaRecordable: boolean("osha_recordable").notNull().default(false),
  },
  (table) => [
    check("ck_incidents_kind", sql`${table.kind} in ('incident', 'near_miss', 'observation')`),
    check("ck_incidents_severity", sql`${table.severity} in ('low', 'medium', 'high', 'critical')`),
    check("ck_incidents_status", sql`${table.status} in ('open', 'closed')`),
    index("ix_incidents_project_occurred").on(table.projectId, table.occurredAt),
  ],
);

// database.md §15: "certifications: person/sub ↔ cert type, expires_at
// (expiry projections drive alerts + sub eligibility gating, FR-SAFE-2/
// FR-SUB-2)." `holderUserId` stays nullable — a sub's worker frequently
// has no ConstructionOS login, so `holderName` is the required, always-
// present display field; `holderUserId` links it to a real account when
// one exists. The FR-SUB-2 "sub eligibility gating" half is dormant until
// Subcontractor mgmt (M14) exists — same "build the rails before the
// first train" precedent as procurement's inventory_item_id column.
// Expiry due-state (valid/expiring_soon/expired) is computed on read from
// expires_at, same "no reconciliation job" pattern as Equipment's
// maintenance due-state projection — not a stored column.
export const certifications = pgTable(
  "certifications",
  {
    ...tenantColumns(),
    holderUserId: uuid("holder_user_id").references(() => users.id),
    holderName: text("holder_name").notNull(),
    certType: text("cert_type").notNull(),
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),
  },
  (table) => [index("ix_certifications_expires").on(table.expiresAt)],
);
