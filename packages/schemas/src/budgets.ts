import { z } from "zod";
import { moneyAmountSchema, quantitySchema, uuidSchema } from "./common";

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
