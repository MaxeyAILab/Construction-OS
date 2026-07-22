import { z } from "zod";
import { moneyAmountSchema } from "./common";

// database.md §17 (FR-CLIENT-2): "options jsonb" — an array of named
// choices, each carrying its own cost impact against the allowance.
export const clientSelectionOptionSchema = z.object({
  label: z.string().min(1),
  costImpactAmount: moneyAmountSchema,
});
export type ClientSelectionOption = z.infer<typeof clientSelectionOptionSchema>;

export const createClientSelectionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  options: z.array(clientSelectionOptionSchema).min(1),
  allowanceAmount: moneyAmountSchema.optional(),
});
export type CreateClientSelectionInput = z.infer<typeof createClientSelectionSchema>;

// Only valid while status='pending' (enforced in SelectionsService, same
// "draft-only edits" precedent as Change Orders).
export const updateClientSelectionSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  options: z.array(clientSelectionOptionSchema).min(1).optional(),
  allowanceAmount: moneyAmountSchema.nullable().optional(),
});
export type UpdateClientSelectionInput = z.infer<typeof updateClientSelectionSchema>;

// The client (or an internal user, for phone/paper-order decisions) picks
// one of the options already on the selection by label.
export const decideClientSelectionSchema = z.object({
  selectedOption: z.string().min(1),
});
export type DecideClientSelectionInput = z.infer<typeof decideClientSelectionSchema>;

export const createPortalMessageSchema = z.object({
  body: z.string().min(1),
});
export type CreatePortalMessageInput = z.infer<typeof createPortalMessageSchema>;
