import { z } from "zod";
import { moneyAmountSchema, paginationQuerySchema, quantitySchema, unitRateAmountSchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

export const createBudgetSchema = z.object({
  sourceEstimateId: uuidSchema.optional(),
  currency: z.string().length(3).default("USD"),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const createBudgetLineSchema = z.object({
  costCodeId: uuidSchema,
  originalAmount: moneyAmountSchema,
});
export type CreateBudgetLineInput = z.infer<typeof createBudgetLineSchema>;

// api.md §10: "Original amounts editable only pre-lock". approved_changes_
// amount is deliberately not patchable here — database.md ties it to
// change-order approval (FR-FIN-2, a separate roadmap row not built yet),
// not a general-purpose field a user edits directly.
export const updateBudgetLineSchema = z.object({
  originalAmount: moneyAmountSchema,
});
export type UpdateBudgetLineInput = z.infer<typeof updateBudgetLineSchema>;

// Only 'manual' entries have a client-facing write path today — every
// other cost_transactions.source value needs a module that doesn't exist
// yet (Procurement, Field time entries, Equipment, Inventory, accounting
// sync). Those modules will call CostTransactionsService directly with
// their own source value when they're built; this schema/endpoint always
// creates source='manual'.
export const createManualCostTransactionSchema = z.object({
  costCodeId: uuidSchema,
  txnDate: isoDateSchema,
  amount: moneyAmountSchema,
  qty: quantitySchema.optional(),
  uom: z.string().optional(),
  memo: z.string().optional(),
});
export type CreateManualCostTransactionInput = z.infer<typeof createManualCostTransactionSchema>;

// --- Invoices, invoice lines, payments (database.md §11; api.md §10;
// FR-VEND-2, FR-SUB-3). Unified AP/AR — direction discriminates the two;
// counterparty_type/id is polymorphic (no FK — InvoicesService validates
// existence against whichever module owns that counterparty type). ---
export const invoiceDirectionSchema = z.enum(["payable", "receivable"]);
export type InvoiceDirection = z.infer<typeof invoiceDirectionSchema>;

export const invoiceCounterpartyTypeSchema = z.enum(["client", "supplier", "subcontractor"]);
export type InvoiceCounterpartyType = z.infer<typeof invoiceCounterpartyTypeSchema>;

export const invoiceStatusSchema = z.enum(["draft", "approved", "paid", "void"]);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const invoiceMatchStatusSchema = z.enum([
  "unmatched",
  "two_way_matched",
  "three_way_matched",
  "mismatched",
]);
export type InvoiceMatchStatus = z.infer<typeof invoiceMatchStatusSchema>;

// purchaseOrderLineId is the 2-/3-way match anchor (FR-VEND-2) — only
// meaningful for direction='payable' lines invoicing against a PO.
// costCodeId is required whenever the invoice carries a projectId (job
// costing needs it); InvoicesService enforces that pairing since zod
// can't express "required if a sibling field on the parent is set."
export const createInvoiceLineSchema = z.object({
  purchaseOrderLineId: uuidSchema.optional(),
  costCodeId: uuidSchema.optional(),
  description: z.string().min(1),
  qty: quantitySchema.optional(),
  // 4-decimal precision to match purchase_order_lines.unit_cost_amount
  // exactly (the 2-way match comparison, FR-VEND-2) — same precision as
  // unitRateAmountSchema used for PO lines.
  unitPriceAmount: unitRateAmountSchema.optional(),
  amount: moneyAmountSchema,
});
export type CreateInvoiceLineInput = z.infer<typeof createInvoiceLineSchema>;

export const createInvoiceSchema = z.object({
  direction: invoiceDirectionSchema,
  counterpartyType: invoiceCounterpartyTypeSchema,
  counterpartyId: uuidSchema,
  projectId: uuidSchema.optional(),
  issueDate: isoDateSchema,
  dueDate: isoDateSchema.optional(),
  taxAmount: moneyAmountSchema.optional(),
  externalRef: z.string().optional(),
  lines: z.array(createInvoiceLineSchema).min(1),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  direction: invoiceDirectionSchema.optional(),
  projectId: uuidSchema.optional(),
  status: invoiceStatusSchema.optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const createPaymentSchema = z.object({
  amount: moneyAmountSchema,
  paidAt: isoDateSchema,
  method: z.string().optional(),
  externalRef: z.string().optional(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
