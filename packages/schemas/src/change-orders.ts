import { z } from "zod";
import { moneyAmountSchema, paginationQuerySchema, uuidSchema } from "./common";

export const changeOrderStatusSchema = z.enum(["draft", "pending_client", "approved", "rejected", "void"]);
export type ChangeOrderStatus = z.infer<typeof changeOrderStatusSchema>;

export const createChangeOrderLineSchema = z.object({
  costCodeId: uuidSchema,
  description: z.string().min(1),
  // Can be negative (a deductive change order) — moneyAmountSchema already
  // allows a leading '-'.
  costImpactAmount: moneyAmountSchema,
});
export type CreateChangeOrderLineInput = z.infer<typeof createChangeOrderLineSchema>;

export const updateChangeOrderLineSchema = createChangeOrderLineSchema.partial();
export type UpdateChangeOrderLineInput = z.infer<typeof updateChangeOrderLineSchema>;

// database.md §11: cost_impact_amount is maintained from lines (like
// estimates.subtotal_amount) — not accepted here. price_impact_amount is
// the client-facing contract price change, set directly (may differ from
// cost_impact_amount by markup).
export const createChangeOrderSchema = z.object({
  title: z.string().min(1),
  reason: z.string().optional(),
  priceImpactAmount: moneyAmountSchema.default("0.00"),
  scheduleImpactDays: z.number().int().default(0),
  lines: z.array(createChangeOrderLineSchema).min(1),
});
export type CreateChangeOrderInput = z.infer<typeof createChangeOrderSchema>;

// Header-only, draft-only edits — status moves only via the dedicated
// lifecycle actions (submit-to-client/approve/reject/void), never a
// generic PATCH {status}.
export const updateChangeOrderSchema = z.object({
  title: z.string().min(1).optional(),
  reason: z.string().nullable().optional(),
  priceImpactAmount: moneyAmountSchema.optional(),
  scheduleImpactDays: z.number().int().optional(),
});
export type UpdateChangeOrderInput = z.infer<typeof updateChangeOrderSchema>;

export const listChangeOrdersQuerySchema = paginationQuerySchema.extend({
  status: changeOrderStatusSchema.optional(),
});
export type ListChangeOrdersQuery = z.infer<typeof listChangeOrdersQuerySchema>;
