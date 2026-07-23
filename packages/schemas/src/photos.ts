import { z } from "zod";
import { isoDateTimeSchema, paginationQuerySchema, uuidSchema } from "./common";
import { completedPartSchema } from "./documents";

// Mirrors FileUploadService's InitiateUploadInput (apps/api files module,
// same "Files has no zod schemas of its own" reasoning as documents.ts's
// initiateDocumentVersionSchema). completedPartSchema itself is reused
// from documents.ts rather than redefined — it's a 1:1 mirror of the same
// FileUploadService.CompletedPart type either way.
export const initiatePhotoUploadSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type InitiatePhotoUploadInput = z.infer<typeof initiatePhotoUploadSchema>;

// database.md §15 (M8, FR-FIELD-3). entityType is open-ended text (report,
// task, delivery, incident...) rather than a strict enum — same "the
// consuming module names its own attachment kind" convention as
// rbac.ts's external_shares entityType, and both are optional: a photo
// can be a general project progress shot with no specific attachment.
export const completePhotoUploadSchema = z.object({
  fileId: uuidSchema,
  parts: z.array(completedPartSchema).optional(),
  projectId: uuidSchema,
  entityType: z.string().min(1).optional(),
  entityId: uuidSchema.optional(),
  takenAt: isoDateTimeSchema,
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  heading: z.number().int().min(0).max(359).optional(),
  deviceId: z.string().min(1).optional(),
});
export type CompletePhotoUploadInput = z.infer<typeof completePhotoUploadSchema>;

export const listPhotosQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  entityType: z.string().min(1).optional(),
  entityId: uuidSchema.optional(),
});
export type ListPhotosQuery = z.infer<typeof listPhotosQuerySchema>;

// ai-spec.md §7.8 (Photo AI, FR-FIELD-7): "auto-tagging (trade, element,
// material) ... defect/quality flagging." Both land in the same
// photos.ai_tags jsonb column — tags auto-apply (reversible/correctable),
// defects stay a draft the caller reviews and, if they agree, turns into
// a real punch task themselves via the existing tasks endpoint (ai-spec
// §6: "draft ... visible only to the user", no separate persistence).
export const photoAiTagSchema = z.object({
  label: z.string().min(1),
  category: z.enum(["trade", "element", "material"]),
  confidence: z.number().min(0).max(1),
});
export type PhotoAiTag = z.infer<typeof photoAiTagSchema>;

export const photoAiDefectSchema = z.object({
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
});
export type PhotoAiDefect = z.infer<typeof photoAiDefectSchema>;

export const photoAiTagsSchema = z.object({
  tags: z.array(photoAiTagSchema).max(10),
  defects: z.array(photoAiDefectSchema).max(10),
  model: z.string(),
  taggedAt: isoDateTimeSchema,
});
export type PhotoAiTags = z.infer<typeof photoAiTagsSchema>;
