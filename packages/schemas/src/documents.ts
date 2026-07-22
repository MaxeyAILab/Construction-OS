import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

export const documentCategorySchema = z.enum([
  "drawing",
  "spec",
  "contract",
  "permit",
  "submittal",
  "photo_album",
  "report",
  "other",
]);
export type DocumentCategory = z.infer<typeof documentCategorySchema>;

export const createFolderSchema = z.object({
  name: z.string().min(1),
  parentId: uuidSchema.optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: uuidSchema.nullable().optional(),
});
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

export const createDocumentSchema = z.object({
  name: z.string().min(1),
  category: documentCategorySchema,
  folderId: uuidSchema.optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z.object({
  name: z.string().min(1).optional(),
  category: documentCategorySchema.optional(),
  folderId: uuidSchema.nullable().optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

// api.md §8: "Tree + metadata; ?q= name search".
export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  folderId: uuidSchema.optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

// Mirrors FileUploadService's InitiateUploadInput (apps/api files module) —
// Files has no zod schemas of its own (it was built with no HTTP surface;
// its own schema comment names Documents as the anticipated first
// consumer), so the shape is defined here instead of duplicated ad hoc.
export const initiateDocumentVersionSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type InitiateDocumentVersionInput = z.infer<typeof initiateDocumentVersionSchema>;

// Mirrors FileUploadService's CompletedPart.
export const completedPartSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1),
});
export type CompletedPartInput = z.infer<typeof completedPartSchema>;

// database.md §16: drawing_meta (sheet no, discipline, revision, scale) is
// only meaningful for category='drawing' documents but isn't enforced here
// — see document-versions.service.ts's schema comment.
export const completeDocumentVersionSchema = z.object({
  fileId: uuidSchema,
  parts: z.array(completedPartSchema).optional(),
  drawingMeta: z.record(z.string(), z.unknown()).optional(),
});
export type CompleteDocumentVersionInput = z.infer<typeof completeDocumentVersionSchema>;

export const createDrawingSetSheetSchema = z.object({
  documentVersionId: uuidSchema,
  sortOrder: z.number().int().optional(),
});
export type CreateDrawingSetSheetInput = z.infer<typeof createDrawingSetSheetSchema>;

export const createDrawingSetSchema = z.object({
  name: z.string().min(1),
  sheets: z.array(createDrawingSetSheetSchema).min(1),
});
export type CreateDrawingSetInput = z.infer<typeof createDrawingSetSchema>;
