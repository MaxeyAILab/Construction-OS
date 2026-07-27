import { z } from "zod";
import { moneyAmountSchema, paginationQuerySchema, percentageSchema, uuidSchema } from "./common";

// --- Subcontractor registry (database.md §17; FR-SUB-1) ---
export const subcontractorPrequalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type SubcontractorPrequalStatus = z.infer<typeof subcontractorPrequalStatusSchema>;

export const createSubcontractorSchema = z.object({
  name: z.string().min(1),
  trades: z.array(z.string()).optional(),
  contact: z.record(z.string(), z.unknown()).optional(),
  prequalStatus: subcontractorPrequalStatusSchema.optional(),
});
export type CreateSubcontractorInput = z.infer<typeof createSubcontractorSchema>;

export const updateSubcontractorSchema = createSubcontractorSchema.partial();
export type UpdateSubcontractorInput = z.infer<typeof updateSubcontractorSchema>;

export const listSubcontractorsQuerySchema = paginationQuerySchema.extend({
  prequalStatus: subcontractorPrequalStatusSchema.optional(),
  trade: z.string().optional(),
});
export type ListSubcontractorsQuery = z.infer<typeof listSubcontractorsQuerySchema>;

// --- Subcontracts + lines (database.md §17; FR-SUB-1/FR-SUB-3-partial) ---
// status enum mirrors change_orders' shape (a contract needing approval,
// not a receiving workflow like POs) — a documented assumption, same
// treatment as tasks.priority's enum.
export const subcontractStatusSchema = z.enum(["draft", "pending_approval", "approved", "void"]);
export type SubcontractStatus = z.infer<typeof subcontractStatusSchema>;

export const createSubcontractSchema = z.object({
  subcontractorId: uuidSchema,
  scope: z.string().optional(),
  retainagePct: percentageSchema.optional(),
});
export type CreateSubcontractInput = z.infer<typeof createSubcontractSchema>;

export const updateSubcontractSchema = z.object({
  scope: z.string().nullable().optional(),
  retainagePct: percentageSchema.optional(),
});
export type UpdateSubcontractInput = z.infer<typeof updateSubcontractSchema>;

export const listSubcontractsQuerySchema = paginationQuerySchema.extend({
  subcontractorId: uuidSchema.optional(),
  status: subcontractStatusSchema.optional(),
});
export type ListSubcontractsQuery = z.infer<typeof listSubcontractsQuerySchema>;

export const createSubcontractLineSchema = z.object({
  costCodeId: uuidSchema,
  description: z.string().min(1),
  amount: moneyAmountSchema,
});
export type CreateSubcontractLineInput = z.infer<typeof createSubcontractLineSchema>;
