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

// --- Document AI (ai-spec.md §7.7, FR-DOC-6) ---

// api.md §8: "POST /drawing-sets/{id}/ai/diff | + AI | Version diff vs
// prior set -> changed-region report." No request body is documented;
// compareToDrawingSetId is an optional escape hatch — when omitted, the
// service auto-selects the most recently created other drawing set for
// the same project (the natural reading of "prior set").
export const drawingSetDiffSchema = z.object({
  compareToDrawingSetId: uuidSchema.optional(),
});
export type DrawingSetDiffInput = z.infer<typeof drawingSetDiffSchema>;

// A sheet's identity across sets is its underlying `documents.id` (stable
// across revisions) — `document_version_id` differs release to release by
// design, so it is what "revised" detects, never what "same sheet" keys
// on.
export const drawingSetDiffSheetSchema = z.object({
  documentId: uuidSchema,
  name: z.string(),
  documentVersionId: uuidSchema,
  versionNo: z.number().int(),
  priorVersionNo: z.number().int().optional(),
});
export type DrawingSetDiffSheet = z.infer<typeof drawingSetDiffSheetSchema>;

// "changed-region report": a sheet-level (added/removed/revised) diff, not
// pixel-level visual region detection — this codebase has no drawing
// OCR/vision-diffing infrastructure (documented gap, same treatment as
// RAG's cross-encoder rerank deferral).
export const drawingSetDiffResultSchema = z.object({
  drawingSetId: uuidSchema,
  comparedToDrawingSetId: uuidSchema,
  added: z.array(drawingSetDiffSheetSchema),
  removed: z.array(drawingSetDiffSheetSchema),
  revised: z.array(drawingSetDiffSheetSchema),
  unchangedCount: z.number().int(),
  summary: z.string().nullable(),
  aiRunId: uuidSchema.nullable(),
});
export type DrawingSetDiffResult = z.infer<typeof drawingSetDiffResultSchema>;
