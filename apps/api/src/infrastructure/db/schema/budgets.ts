import { sql } from "drizzle-orm";
import { check, date, index, integer, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { documents, documentVersions } from "./documents";
import { purchaseOrderLines } from "./procurement";
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

// database.md §11 (api.md §10, FR-VEND-2/FR-SUB-3): "unified AP/AR —
// direction, counterparty_type/id (client company, supplier,
// subcontractor)... 3-way-match state on payable." One table serves
// supplier invoices (Supplier Portal, M15), subcontractor invoices
// (FR-SUB-3 — deferred until now, unblocked by this table existing), and
// future client billing/AIA pay-apps — not three parallel tables.
// counterparty_id is polymorphic (no FK), same "type discriminator +
// bare uuid" precedent as activities.entity_type/entity_id; the actual
// row lookup happens in InvoicesService against whichever module's
// service the counterparty_type points to. match_status/status value
// sets aren't enumerated in database.md — documented assumption, same
// as incidents.severity.
export const invoices = pgTable(
  "invoices",
  {
    ...tenantColumns(),
    direction: text("direction").notNull(),
    counterpartyType: text("counterparty_type").notNull(),
    counterpartyId: uuid("counterparty_id").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    number: integer("number").notNull(),
    status: text("status").notNull().default("draft"),
    // Only meaningful for direction='payable' lines tied to a PO line;
    // null means "nothing to match against" (subcontractor/client
    // invoices, or a payable invoice with no PO-linked lines).
    matchStatus: text("match_status"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    subtotalAmount: numeric("subtotal_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    // Maintained aggregate (sum of payments), same pattern as
    // budget_lines.committed_amount — drives status flipping to 'paid'.
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    externalRef: text("external_ref"),
  },
  (table) => [
    check("ck_invoices_direction", sql`${table.direction} in ('payable', 'receivable')`),
    check("ck_invoices_counterparty_type", sql`${table.counterpartyType} in ('client', 'supplier', 'subcontractor')`),
    check("ck_invoices_status", sql`${table.status} in ('draft', 'approved', 'paid', 'void')`),
    check(
      "ck_invoices_match_status",
      sql`${table.matchStatus} is null or ${table.matchStatus} in ('unmatched', 'two_way_matched', 'three_way_matched', 'mismatched')`,
    ),
    uniqueIndex("ux_invoices_tenant_direction_number").on(table.tenantId, table.direction, table.number),
    index("ix_invoices_tenant_dir_status_due").on(table.tenantId, table.direction, table.status, table.dueDate),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    ...tenantColumns(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    // Only set for payable lines invoicing against a PO — the anchor for
    // 2-/3-way matching (FR-VEND-2). Null for subcontractor/client lines
    // and for payable lines with no PO (e.g. overhead invoices).
    purchaseOrderLineId: uuid("purchase_order_line_id").references(() => purchaseOrderLines.id),
    costCodeId: uuid("cost_code_id").references(() => costCodes.id),
    description: text("description").notNull(),
    qty: numeric("qty", { precision: 14, scale: 3 }),
    // Scale 4 to match purchase_order_lines.unit_cost_amount exactly (the
    // 2-way match comparison, FR-VEND-2).
    unitPriceAmount: numeric("unit_price_amount", { precision: 14, scale: 4 }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    matchStatus: text("match_status"),
  },
  (table) => [
    check(
      "ck_invoice_lines_match_status",
      sql`${table.matchStatus} is null or ${table.matchStatus} in ('unmatched', 'two_way_matched', 'three_way_matched', 'mismatched')`,
    ),
    index("ix_invoice_lines_invoice").on(table.invoiceId),
  ],
);

// database.md §11: "applied amounts vs invoices (partial payments
// supported)."
export const payments = pgTable(
  "payments",
  {
    ...tenantColumns(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    paidAt: date("paid_at").notNull(),
    method: text("method"),
    externalRef: text("external_ref"),
  },
  (table) => [index("ix_payments_invoice").on(table.invoiceId)],
);

// database.md §11 (FR-FIN-4): "AIA-style progress billing: period,
// per-cost-code scheduled_value/previous_completed/this_period/
// stored_materials/retainage_pct/amount, generated G702/G703 PDF ref in
// documents." period_number is sequential per project (same "max+1 at
// creation" convention as purchase_orders.number, scoped to the
// project instead of the tenant). pdf_status mirrors export_jobs.status
// — the same async-job-then-poll shape (api.md §10: "POST
// {id}/generate-pdf -> 202"). Approval bills the project's client
// (counterparty_type='client') via a real Invoice — one line per cost
// code — same "lifecycle action creates a real financial record"
// precedent as PurchaseOrderLifecycleService.approve().
export const paymentApplications = pgTable(
  "payment_applications",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    periodNumber: integer("period_number").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    status: text("status").notNull().default("draft"),
    pdfStatus: text("pdf_status").notNull().default("none"),
    // Created once (DocumentsService.create, category='report') the first
    // time a PDF is generated; later regenerations just add a new version
    // to this same document — same "current is a single FK" pattern as
    // documents.current_version_id.
    documentId: uuid("document_id").references(() => documents.id),
    pdfDocumentVersionId: uuid("pdf_document_version_id").references(() => documentVersions.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    totalScheduledValue: numeric("total_scheduled_value", { precision: 14, scale: 2 }).notNull().default("0"),
    totalCompletedAndStored: numeric("total_completed_and_stored", { precision: 14, scale: 2 }).notNull().default("0"),
    totalRetainage: numeric("total_retainage", { precision: 14, scale: 2 }).notNull().default("0"),
    currentPaymentDue: numeric("current_payment_due", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (table) => [
    check("ck_payment_applications_status", sql`${table.status} in ('draft', 'submitted', 'approved', 'void')`),
    check("ck_payment_applications_pdf_status", sql`${table.pdfStatus} in ('none', 'generating', 'ready', 'failed')`),
    uniqueIndex("ux_payment_applications_project_period").on(table.tenantId, table.projectId, table.periodNumber),
    index("ix_payment_applications_project_status").on(table.projectId, table.status),
  ],
);

export const paymentApplicationLines = pgTable(
  "payment_application_lines",
  {
    ...tenantColumns(),
    paymentApplicationId: uuid("payment_application_id")
      .notNull()
      .references(() => paymentApplications.id),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    scheduledValue: numeric("scheduled_value", { precision: 14, scale: 2 }).notNull().default("0"),
    previousCompleted: numeric("previous_completed", { precision: 14, scale: 2 }).notNull().default("0"),
    thisPeriod: numeric("this_period", { precision: 14, scale: 2 }).notNull().default("0"),
    materialsStored: numeric("materials_stored", { precision: 14, scale: 2 }).notNull().default("0"),
    completedToDate: numeric("completed_to_date", { precision: 14, scale: 2 }).generatedAlwaysAs(
      sql`previous_completed + this_period + materials_stored`,
    ),
    retainagePct: numeric("retainage_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    retainageAmount: numeric("retainage_amount", { precision: 14, scale: 2 }).generatedAlwaysAs(
      sql`round((previous_completed + this_period + materials_stored) * retainage_pct / 100, 2)`,
    ),
  },
  (table) => [
    uniqueIndex("ux_payment_application_lines_app_cost_code").on(table.paymentApplicationId, table.costCodeId),
    index("ix_payment_application_lines_app").on(table.paymentApplicationId),
  ],
);
