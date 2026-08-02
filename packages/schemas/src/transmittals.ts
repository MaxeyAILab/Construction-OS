import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

// database.md §25 / api.md §20 (M3, FR-DOC-8).
export const transmittalPurposeSchema = z.enum(["for_review", "for_approval", "for_record", "as_requested"]);
export type TransmittalPurpose = z.infer<typeof transmittalPurposeSchema>;

export const transmittalStatusSchema = z.enum(["draft", "sent"]);
export type TransmittalStatus = z.infer<typeof transmittalStatusSchema>;

export const createTransmittalSchema = z.object({
  purpose: transmittalPurposeSchema,
  subject: z.string().min(1),
  message: z.string().optional(),
  items: z
    .array(
      z.object({
        documentVersionId: uuidSchema,
        description: z.string().optional(),
      }),
    )
    .min(1),
  recipientUserIds: z.array(uuidSchema).min(1),
});
export type CreateTransmittalInput = z.infer<typeof createTransmittalSchema>;

export const listTransmittalsQuerySchema = paginationQuerySchema.extend({
  status: transmittalStatusSchema.optional(),
});
export type ListTransmittalsQuery = z.infer<typeof listTransmittalsQuerySchema>;

// FR-DOC-9. entity_type deliberately excludes 'submittal' — see this
// schema's database.md §25 counterpart for why.
export const approvalEntityTypeSchema = z.enum(["document", "transmittal"]);
export type ApprovalEntityType = z.infer<typeof approvalEntityTypeSchema>;

export const createApprovalMatrixSchema = z
  .object({
    entityType: approvalEntityTypeSchema,
    name: z.string().min(1),
    steps: z
      .array(
        z.object({
          stepOrder: z.number().int().positive(),
          approverUserId: uuidSchema,
          label: z.string().optional(),
        }),
      )
      .min(1),
  })
  .refine(
    (v) => {
      const orders = v.steps.map((s) => s.stepOrder).sort((a, b) => a - b);
      return orders.every((n, i) => n === i + 1);
    },
    { message: "steps.stepOrder must be a contiguous 1..N sequence", path: ["steps"] },
  );
export type CreateApprovalMatrixInput = z.infer<typeof createApprovalMatrixSchema>;

export const listApprovalMatricesQuerySchema = z.object({
  entityType: approvalEntityTypeSchema,
});
export type ListApprovalMatricesQuery = z.infer<typeof listApprovalMatricesQuerySchema>;

export const startApprovalInstanceSchema = z.object({
  approvalMatrixId: uuidSchema,
  entityType: approvalEntityTypeSchema,
  entityId: uuidSchema,
});
export type StartApprovalInstanceInput = z.infer<typeof startApprovalInstanceSchema>;

export const approvalDecisionSchema = z.enum(["approved", "rejected"]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const decideApprovalInstanceSchema = z.object({
  decision: approvalDecisionSchema,
  comments: z.string().optional(),
});
export type DecideApprovalInstanceInput = z.infer<typeof decideApprovalInstanceSchema>;
