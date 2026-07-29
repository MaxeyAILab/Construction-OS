import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

// spec.md §13.18 (M19, FR-CLOSE-1). Standard categories the checklist
// anticipates, plus 'other' for tenant-defined items.
export const closeoutChecklistCategorySchema = z.enum([
  "as_built_drawings",
  "om_manuals",
  "warranty_certificates",
  "permits_certificate_of_occupancy",
  "training_signoff",
  "lien_waivers",
  "other",
]);
export type CloseoutChecklistCategory = z.infer<typeof closeoutChecklistCategorySchema>;

export const closeoutChecklistItemStatusSchema = z.enum(["pending", "complete", "not_applicable"]);
export type CloseoutChecklistItemStatus = z.infer<typeof closeoutChecklistItemStatusSchema>;

export const createCloseoutChecklistItemSchema = z.object({
  category: closeoutChecklistCategorySchema,
  title: z.string().min(1),
});
export type CreateCloseoutChecklistItemInput = z.infer<typeof createCloseoutChecklistItemSchema>;

export const updateCloseoutChecklistItemSchema = z.object({
  status: closeoutChecklistItemStatusSchema.optional(),
  documentId: uuidSchema.nullable().optional(),
});
export type UpdateCloseoutChecklistItemInput = z.infer<typeof updateCloseoutChecklistItemSchema>;

// FR-CLOSE-2/3.
export const closeoutPackageStatusSchema = z.enum(["assembled", "delivered"]);
export type CloseoutPackageStatus = z.infer<typeof closeoutPackageStatusSchema>;

// FR-CLOSE-4.
export const warrantyTypeSchema = z.enum(["labor", "material", "manufacturer"]);
export type WarrantyType = z.infer<typeof warrantyTypeSchema>;

export const warrantyResponsiblePartyTypeSchema = z.enum(["subcontractor", "supplier", "manufacturer"]);
export type WarrantyResponsiblePartyType = z.infer<typeof warrantyResponsiblePartyTypeSchema>;

export const warrantyDueStateSchema = z.enum(["active", "expiring_soon", "expired"]);
export type WarrantyDueState = z.infer<typeof warrantyDueStateSchema>;

export const createWarrantySchema = z
  .object({
    scope: z.string().min(1),
    warrantyType: warrantyTypeSchema,
    responsiblePartyType: warrantyResponsiblePartyTypeSchema,
    responsibleSubcontractorId: uuidSchema.optional(),
    responsibleSupplierId: uuidSchema.optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)"),
    durationMonths: z.number().int().positive(),
    documentId: uuidSchema.optional(),
  })
  .refine((v) => v.responsiblePartyType !== "subcontractor" || !!v.responsibleSubcontractorId, {
    message: "responsibleSubcontractorId is required when responsiblePartyType is 'subcontractor'",
    path: ["responsibleSubcontractorId"],
  })
  .refine((v) => v.responsiblePartyType !== "supplier" || !!v.responsibleSupplierId, {
    message: "responsibleSupplierId is required when responsiblePartyType is 'supplier'",
    path: ["responsibleSupplierId"],
  });
export type CreateWarrantyInput = z.infer<typeof createWarrantySchema>;

export const updateWarrantySchema = z.object({
  responsiblePartyType: warrantyResponsiblePartyTypeSchema.optional(),
  responsibleSubcontractorId: uuidSchema.nullable().optional(),
  responsibleSupplierId: uuidSchema.nullable().optional(),
  durationMonths: z.number().int().positive().optional(),
  documentId: uuidSchema.nullable().optional(),
});
export type UpdateWarrantyInput = z.infer<typeof updateWarrantySchema>;

export const listWarrantiesQuerySchema = paginationQuerySchema.extend({
  dueState: warrantyDueStateSchema.optional(),
});
export type ListWarrantiesQuery = z.infer<typeof listWarrantiesQuerySchema>;

// FR-CLOSE-5.
export const warrantyClaimStatusSchema = z.enum(["submitted", "acknowledged", "in_progress", "resolved", "rejected"]);
export type WarrantyClaimStatus = z.infer<typeof warrantyClaimStatusSchema>;

export const createWarrantyClaimSchema = z.object({
  description: z.string().min(1),
});
export type CreateWarrantyClaimInput = z.infer<typeof createWarrantyClaimSchema>;

export const updateWarrantyClaimSchema = z.object({
  status: warrantyClaimStatusSchema,
  resolutionNotes: z.string().optional(),
});
export type UpdateWarrantyClaimInput = z.infer<typeof updateWarrantyClaimSchema>;
