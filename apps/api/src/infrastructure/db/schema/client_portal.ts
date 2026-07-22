import { sql } from "drizzle-orm";
import { check, index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { projects } from "./projects";
import { users } from "./users";

// database.md §17 (M13, FR-CLIENT-2): "Client-facing choices (allowances/
// options): title, options jsonb, allowance_amount, selected_option,
// status, decided_by/at — approval events feed change orders where
// cost-impacting." `options` is an array of `{ label, costImpactAmount }`;
// `selectedOption` stores the chosen label (not a duplicated object) so
// there's one source of truth for an option's cost. No cost_code_id exists
// on this table (database.md doesn't document one), so the
// "feed change orders where cost-impacting" half isn't wired up yet — a
// change order line needs a cost code, and there's no documented way to
// derive one from a selection; client_selection.decided.v1 carries the
// cost delta so a future consumer can do that once cost-code assignment
// is specified. Flagged follow-up, not silently dropped.
export const clientSelections = pgTable(
  "client_selections",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    description: text("description"),
    options: jsonb("options").notNull(),
    allowanceAmount: numeric("allowance_amount", { precision: 14, scale: 2 }),
    selectedOption: text("selected_option"),
    status: text("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    check("ck_client_selections_status", sql`${table.status} in ('pending', 'decided')`),
    index("ix_client_selections_project_status").on(table.projectId, table.status),
  ],
);

// database.md §17 (FR-CLIENT-3): "Threaded external communication scoped
// to entity_type/id with audience — kept separate from internal comments
// so internal chatter can never leak (FR-CLIENT-4 by construction)." A
// deliberately separate table from the internal `comments` polymorphic
// stream, not a shared one with an "internal-only" flag — the isolation
// is structural, not a filter that could be forgotten.
export const portalMessages = pgTable(
  "portal_messages",
  {
    ...tenantColumns(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    audience: text("audience").notNull(),
    body: text("body").notNull(),
  },
  (table) => [
    check("ck_portal_messages_audience", sql`${table.audience} in ('client', 'subcontractor', 'supplier')`),
    index("ix_portal_messages_entity").on(table.tenantId, table.entityType, table.entityId),
  ],
);
