import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

export const submittalStatusSchema = z.enum(["draft", "submitted", "reviewed", "approved", "rejected", "resubmit"]);
export type SubmittalStatus = z.infer<typeof submittalStatusSchema>;

export const createSubmittalSchema = z.object({
  specSection: z.string().min(1),
  title: z.string().min(1),
  documentId: uuidSchema,
  reviewerContactId: uuidSchema.optional(),
  dueDate: isoDateSchema.optional(),
});
export type CreateSubmittalInput = z.infer<typeof createSubmittalSchema>;

// status is validated against the allowed-transitions map in
// SubmittalsService.update, not here — api.md §8: "Review workflow."
export const updateSubmittalSchema = z.object({
  specSection: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  status: submittalStatusSchema.optional(),
  reviewerContactId: uuidSchema.nullable().optional(),
  dueDate: isoDateSchema.nullable().optional(),
  reviewComments: z.string().min(1).nullable().optional(),
});
export type UpdateSubmittalInput = z.infer<typeof updateSubmittalSchema>;

export const listSubmittalsQuerySchema = paginationQuerySchema.extend({
  status: submittalStatusSchema.optional(),
});
export type ListSubmittalsQuery = z.infer<typeof listSubmittalsQuerySchema>;
