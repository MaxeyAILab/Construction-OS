import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { projects } from "./projects";

// database.md §8 (M1). "External organizations (client orgs, design
// firms). Distinct from `companies` (tenants) — deliberate: never mix
// tenant identity with CRM data."
export const contactCompanies = pgTable(
  "contact_companies",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    industry: text("industry"),
    notes: text("notes"),
    customFields: jsonb("custom_fields").notNull().default({}),
  },
  (table) => [index("ix_contact_companies_name_trgm").using("gin", sql`${table.name} gin_trgm_ops`)],
);

// database.md §8: "people (clients, architects, reps)." `kind` isn't
// enumerated in the spec — a documented assumption of the common AEC
// contact roles, same "shape is real, values are a documented assumption"
// treatment as daily-reports' weatherSchema.
export const contacts = pgTable(
  "contacts",
  {
    ...tenantColumns(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    contactCompanyId: uuid("contact_company_id").references(() => contactCompanies.id),
    kind: text("kind").notNull().default("other"),
    notes: text("notes"),
    customFields: jsonb("custom_fields").notNull().default({}),
  },
  (table) => [
    check(
      "ck_contacts_kind",
      sql`${table.kind} in ('client', 'architect', 'engineer', 'subcontractor', 'vendor', 'other')`,
    ),
    index("ix_contacts_tenant_name").on(table.tenantId, table.lastName, table.firstName),
    index("ix_contacts_name_trgm").using("gin", sql`(${table.firstName} || ' ' || ${table.lastName}) gin_trgm_ops`),
    index("ix_contacts_email_trgm").using("gin", sql`${table.email} gin_trgm_ops`),
  ],
);

// database.md §8: "tenant-configurable ordered stages." No FK to a
// "won"/"lost" concept here — those are opportunities.status, deliberately
// independent of which visual pipeline column a deal sits in.
export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull(),
    defaultProbabilityPct: numeric("default_probability_pct", { precision: 5, scale: 2 }),
  },
  (table) => [
    uniqueIndex("ux_pipeline_stages_tenant_name").on(table.tenantId, table.name),
    index("ix_pipeline_stages_tenant_order").on(table.tenantId, table.displayOrder),
  ],
);

// database.md §8: "deals in pipeline." FR-CRM-4: won_project_id is set
// atomically by OpportunitiesService.win() in the same transaction that
// creates the project — "1->0..1 projects on win (zero re-entry)".
export const opportunities = pgTable(
  "opportunities",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactCompanyId: uuid("contact_company_id").references(() => contactCompanies.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id),
    expectedValueAmount: numeric("expected_value_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    probability: numeric("probability", { precision: 5, scale: 2 }),
    expectedCloseDate: date("expected_close_date"),
    source: text("source"),
    status: text("status").notNull().default("open"),
    lostReason: text("lost_reason"),
    wonProjectId: uuid("won_project_id").references(() => projects.id),
  },
  (table) => [
    check("ck_opportunities_status", sql`${table.status} in ('open', 'won', 'lost')`),
    index("ix_opportunities_tenant_stage_status").on(table.tenantId, table.stageId, table.status),
    index("ix_opportunities_tenant_close_date").on(table.tenantId, table.expectedCloseDate),
  ],
);

// database.md §8: "calls/emails/meetings/notes polymorphically attached
// ... used by CRM and beyond." entity_type is deliberately unconstrained
// text, not a CHECK enum — same polymorphic-with-no-CHECK precedent as
// `comments` (integrity enforced at the application layer per database.md's
// documented normalization trade-off, no FK on entity_id). Only
// api.md §4's `/crm/opportunities/{id}/activities` has a wired endpoint
// this pass (entity_type='opportunity'); "and beyond" (contacts, tasks,
// RFIs, POs) is later cross-module reuse, not invented ahead of need.
export const activities = pgTable(
  "activities",
  {
    ...tenantColumns(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject"),
    body: text("body"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_activities_kind", sql`${table.kind} in ('call', 'email', 'meeting', 'note')`),
    index("ix_activities_tenant_entity").on(table.tenantId, table.entityType, table.entityId, table.occurredAt.desc()),
  ],
);
