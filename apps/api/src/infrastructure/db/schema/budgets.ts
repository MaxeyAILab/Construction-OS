import { sql } from "drizzle-orm";
import { check, date, index, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { costCodes, projects } from "./projects";

// database.md §11: "budget -> commitment -> actual -> forecast is the
// platform's financial spine (FR-FIN-*). All writes transactional; all
// mutations audited." One active budget per project.
export const budgets = pgTable(
  "budgets",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    // No FK yet: Estimating (M2) doesn't exist — same "flag it" precedent
    // as projects.clientContactCompanyId.
    sourceEstimateId: uuid("source_estimate_id"),
    status: text("status").notNull().default("active"),
    // Maintained by BudgetService whenever a line's original/approved-
    // changes amount changes (sum across lines) — Postgres generated
    // columns can't reference other tables, so this can't be a DB-level
    // generated column the way budget_lines.revised_amount is.
    originalTotalAmount: numeric("original_total_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    revisedTotalAmount: numeric("revised_total_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("USD"),
  },
  (table) => [
    check("ck_budgets_status", sql`${table.status} in ('active', 'locked', 'superseded')`),
    // Partial unique index: only one *active* budget per project — a
    // superseded/locked budget doesn't block creating a new active one.
    uniqueIndex("ux_budgets_tenant_project_active")
      .on(table.tenantId, table.projectId)
      .where(sql`${table.status} = 'active'`),
  ],
);

// database.md §11: "per-cost-code money columns... committed_amount/
// actual_amount are maintained by triggers/use-cases in the same
// transaction as the source rows... the live-margin view is a plain read,
// always exact, no reconciliation job."
export const budgetLines = pgTable(
  "budget_lines",
  {
    ...tenantColumns(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    originalAmount: numeric("original_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    approvedChangesAmount: numeric("approved_changes_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    revisedAmount: numeric("revised_amount", { precision: 14, scale: 2 }).generatedAlwaysAs(
      sql`original_amount + approved_changes_amount`,
    ),
    committedAmount: numeric("committed_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    actualAmount: numeric("actual_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    // Simple budget-based forecast (forecastToComplete = revised - actual,
    // forecastAtCompletion = actual + forecastToComplete) maintained by
    // CostTransactionsService alongside actual_amount — not EVM or
    // AI-driven (FR-FIN-7, not built). Flagged as a follow-up refinement.
    forecastToCompleteAmount: numeric("forecast_to_complete_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    forecastAtCompletionAmount: numeric("forecast_at_completion_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
  },
  (table) => [
    check(
      "ck_budget_lines_amounts",
      sql`${table.originalAmount} >= 0 and ${table.committedAmount} >= 0 and ${table.actualAmount} >= 0`,
    ),
    uniqueIndex("ux_budget_lines_budget_cost_code").on(table.budgetId, table.costCodeId),
    index("ix_budget_lines_budget").on(table.budgetId),
  ],
);

// database.md §11: "Written when a PO/subcontract is approved
// (FR-PROC-3)". Now has a real writer: PurchaseOrderLifecycleService.
// approve() (Procurement, M5) inserts one row per cost code represented
// on the PO's lines and bumps budget_lines.committed_amount in the same
// transaction — same direct-schema-write pattern as
// ChangeOrderLifecycleService.approve()'s budget_lines propagation.
// `kind='subcontract'` stays unwritten until Subcontractor Management
// (M14, a later roadmap row) exists to write it.
export const commitments = pgTable(
  "commitments",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    kind: text("kind").notNull(),
    sourceId: uuid("source_id").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    status: text("status").notNull().default("active"),
  },
  (table) => [
    check("ck_commitments_kind", sql`${table.kind} in ('purchase_order', 'subcontract')`),
    check("ck_commitments_status", sql`${table.status} in ('active', 'closed', 'cancelled')`),
    index("ix_commitments_project_cost_code").on(table.projectId, table.costCodeId),
  ],
);

// database.md §11: "the append-only ledger of actual costs... deliberately
// a ledger (facts), with budget_lines as maintained aggregates."
export const costTransactions = pgTable(
  "cost_transactions",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    source: text("source").notNull(),
    // Nullable: only 'manual' entries (the only source with a real write
    // path today — every other source needs a module that doesn't exist
    // yet) have no backing record to reference.
    sourceId: uuid("source_id"),
    txnDate: date("txn_date").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    qty: numeric("qty", { precision: 14, scale: 3 }),
    uom: text("uom"),
    memo: text("memo"),
    externalRef: text("external_ref"),
  },
  (table) => [
    check(
      "ck_cost_transactions_source",
      sql`${table.source} in ('supplier_invoice', 'sub_invoice', 'time_entry', 'equipment_usage', 'inventory_issue', 'manual', 'accounting_sync')`,
    ),
    index("ix_costtxn_tenant_project_code_date").on(
      table.tenantId,
      table.projectId,
      table.costCodeId,
      table.txnDate,
    ),
    index("ix_costtxn_source").on(table.source, table.sourceId),
  ],
);
