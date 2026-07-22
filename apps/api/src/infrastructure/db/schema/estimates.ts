import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { projects } from "./projects";

// database.md §10 (M2): tenant cost book. cost_items declared first since
// assemblies/estimate_lines reference it.
export const costItems = pgTable(
  "cost_items",
  {
    ...tenantColumns(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    uom: text("uom").notNull(),
    currentUnitCostAmount: numeric("current_unit_cost_amount", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    laborHoursPerUnit: numeric("labor_hours_per_unit", { precision: 10, scale: 4 }),
  },
  (table) => [uniqueIndex("ux_cost_items_tenant_code").on(table.tenantId, table.code)],
);

// database.md §10: "append-only price observations... the raw feed for
// Estimator/Procurement AI (FR-PROC-5)". 'manual' is the only source with
// a real write path today — Procurement (M5) doesn't exist to post 'po'/
// 'invoice' observations, same precedent as budgets' cost_transactions.
export const costItemPriceHistory = pgTable(
  "cost_item_price_history",
  {
    ...tenantColumns(),
    costItemId: uuid("cost_item_id")
      .notNull()
      .references(() => costItems.id),
    source: text("source").notNull(),
    unitCostAmount: numeric("unit_cost_amount", { precision: 14, scale: 4 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "ck_cost_item_price_history_source",
      sql`${table.source} in ('po', 'invoice', 'manual', 'supplier_quote')`,
    ),
    index("ix_cost_item_price_history_item_date").on(table.costItemId, table.observedAt),
  ],
);

// database.md §10: "reusable build-ups".
export const assemblies = pgTable(
  "assemblies",
  {
    ...tenantColumns(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    uom: text("uom").notNull(),
  },
  (table) => [uniqueIndex("ux_assemblies_tenant_code").on(table.tenantId, table.code)],
);

export const assemblyItems = pgTable(
  "assembly_items",
  {
    ...tenantColumns(),
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => assemblies.id),
    costItemId: uuid("cost_item_id")
      .notNull()
      .references(() => costItems.id),
    qtyPerUnit: numeric("qty_per_unit", { precision: 14, scale: 4 }).notNull(),
  },
  (table) => [index("ix_assembly_items_assembly").on(table.assemblyId)],
);

// database.md §10: "versioned pricing container." opportunity_id ties to
// CRM (M1), which doesn't exist yet — no FK, same precedent as
// projects.clientContactCompanyId. Every estimate built against this
// codebase today will have project_id set (opportunity-based pre-award
// estimating isn't reachable without CRM) — ck_estimates_parent still
// enforces "exactly one" so the column is ready for when M1 lands.
export const estimates = pgTable(
  "estimates",
  {
    ...tenantColumns(),
    opportunityId: uuid("opportunity_id"),
    projectId: uuid("project_id").references(() => projects.id),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    markupPct: numeric("markup_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    overheadPct: numeric("overhead_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    contingencyPct: numeric("contingency_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    taxPct: numeric("tax_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    // Cost-basis subtotal (sum of estimate_lines.total_cost_amount) and
    // the final priced total after the markup/overhead/contingency/tax
    // cascade — see EstimateService's documented formula. Maintained by
    // the application in the same transaction as line mutations
    // (database.md: "recomputed from lines on every mutation... same
    // transaction"), not a DB trigger.
    subtotalAmount: numeric("subtotal_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    validUntil: date("valid_until"),
  },
  (table) => [
    check(
      "ck_estimates_status",
      sql`${table.status} in ('draft', 'submitted', 'won', 'lost', 'superseded')`,
    ),
    check(
      "ck_estimates_parent",
      sql`(${table.opportunityId} is null) <> (${table.projectId} is null)`,
    ),
    uniqueIndex("ux_estimates_tenant_parent_version").on(
      table.tenantId,
      sql`coalesce(${table.opportunityId}, ${table.projectId})`,
      table.version,
    ),
  ],
);

export const estimateLines = pgTable(
  "estimate_lines",
  {
    ...tenantColumns(),
    estimateId: uuid("estimate_id")
      .notNull()
      .references(() => estimates.id),
    // Text, not a cost_codes FK: an estimate may predate the project (or
    // even the opportunity->project conversion) that would own a real
    // cost_codes row — database.md calls this out explicitly as "code
    // string pre-project". convert-to-budget maps/creates real cost_codes
    // from this string.
    costCodeRef: text("cost_code_ref").notNull(),
    description: text("description").notNull(),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    uom: text("uom").notNull(),
    unitCostAmount: numeric("unit_cost_amount", { precision: 14, scale: 4 }).notNull(),
    // Optional per-line sell-price override (e.g. a client allowance) —
    // not summed into the estimate total by default; see EstimateService's
    // doc comment for why total_amount is derived from the header
    // percentages against the cost subtotal instead.
    unitPriceAmount: numeric("unit_price_amount", { precision: 14, scale: 4 }),
    totalCostAmount: numeric("total_cost_amount", { precision: 14, scale: 2 }).generatedAlwaysAs(
      sql`round(qty * unit_cost_amount, 2)`,
    ),
    totalPriceAmount: numeric("total_price_amount", { precision: 14, scale: 2 }).generatedAlwaysAs(
      sql`round(qty * unit_price_amount, 2)`,
    ),
    assemblyId: uuid("assembly_id").references(() => assemblies.id),
    sortOrder: integer("sort_order").notNull().default(0),
    source: text("source").notNull().default("manual"),
    // No FK yet: ai_runs (M17, Phase 1D) doesn't exist — same precedent as
    // audit_log.ai_run_id.
    aiRunId: uuid("ai_run_id"),
  },
  (table) => [
    check(
      "ck_estimate_lines_source",
      sql`${table.source} in ('manual', 'assembly', 'ai', 'historical')`,
    ),
    index("ix_estlines_estimate").on(table.estimateId, table.sortOrder),
  ],
);
