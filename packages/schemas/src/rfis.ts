import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

export const rfiStatusSchema = z.enum(["draft", "open", "answered", "closed", "void"]);
export type RfiStatus = z.infer<typeof rfiStatusSchema>;

export const createRfiSchema = z.object({
  subject: z.string().min(1),
  question: z.string().min(1),
  assignedToContactId: uuidSchema.optional(),
  dueDate: isoDateSchema.optional(),
  costImpactFlag: z.boolean().optional(),
  scheduleImpactFlag: z.boolean().optional(),
  linkedActivityId: uuidSchema.optional(),
  linkedDrawingRef: uuidSchema.optional(),
});
export type CreateRfiInput = z.infer<typeof createRfiSchema>;

// status is validated against the allowed-transitions map in
// RfisService.update, not here — api.md §8: "status machine enforced".
export const updateRfiSchema = z.object({
  subject: z.string().min(1).optional(),
  question: z.string().min(1).optional(),
  answer: z.string().min(1).nullable().optional(),
  status: rfiStatusSchema.optional(),
  assignedToContactId: uuidSchema.nullable().optional(),
  dueDate: isoDateSchema.nullable().optional(),
  costImpactFlag: z.boolean().optional(),
  scheduleImpactFlag: z.boolean().optional(),
  linkedActivityId: uuidSchema.nullable().optional(),
  linkedDrawingRef: uuidSchema.nullable().optional(),
});
export type UpdateRfiInput = z.infer<typeof updateRfiSchema>;

export const listRfisQuerySchema = paginationQuerySchema.extend({
  status: rfiStatusSchema.optional(),
});
export type ListRfisQuery = z.infer<typeof listRfisQuerySchema>;
