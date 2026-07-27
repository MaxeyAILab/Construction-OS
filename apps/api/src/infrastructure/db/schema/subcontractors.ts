import { sql } from "drizzle-orm";
import { check, index, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { costCodes, projects } from "./projects";

// database.md §17 (M14): "Company-level registry (name, trades text[],
// contact, prequal_status, performance jsonb AI score — FR-SUB-4)."
// `performance` stays null until Subcontractor performance scoring
// (FR-SUB-4, a "should"-level AI capability) gets its own later roadmap
// row — same "AI gets its own row" convention as suppliers.rating and
// equipment's maintenance predictive row.
export const subcontractors = pgTable(
  "subcontractors",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    trades: text("trades").array(),
    contact: jsonb("contact"),
    prequalStatus: text("prequal_status").notNull().default("pending"),
    performance: jsonb("performance"),
  },
  (table) => [
    check("ck_subcontractors_prequal_status", sql`${table.prequalStatus} in ('pending', 'approved', 'rejected')`),
  ],
);

// database.md §17: "Contract per project/sub: scope, amounts per cost
// code, retainage_pct, status; approval creates commitments (mirror of
// PO flow, FR-SUB-3)." status enum mirrors change_orders' shape (a
// contract needing approval, not a receiving workflow like POs) — a
// documented assumption, same treatment as tasks.priority's enum.
export const subcontracts = pgTable(
  "subcontracts",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    subcontractorId: uuid("subcontractor_id")
      .notNull()
      .references(() => subcontractors.id),
    scope: text("scope"),
    retainagePct: numeric("retainage_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    status: text("status").notNull().default("draft"),
  },
  (table) => [
    check("ck_subcontracts_status", sql`${table.status} in ('draft', 'pending_approval', 'approved', 'void')`),
    index("ix_subcontracts_tenant_project_status").on(table.tenantId, table.projectId, table.status),
  ],
);

export const subcontractLines = pgTable(
  "subcontract_lines",
  {
    ...tenantColumns(),
    subcontractId: uuid("subcontract_id")
      .notNull()
      .references(() => subcontracts.id),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [index("ix_subcontract_lines_subcontract").on(table.subcontractId)],
);
