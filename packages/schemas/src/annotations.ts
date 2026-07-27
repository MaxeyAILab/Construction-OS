import { z } from "zod";

// ui-design-system.md's DrawingViewer markup toolbar: pen/box/text/measure.
export const annotationKindSchema = z.enum(["pen", "box", "text", "measure"]);
export type AnnotationKind = z.infer<typeof annotationKindSchema>;

// geometry is tool-shape-dependent (path points, bounding box, label
// position, two-point ruler) so it stays a free-form object rather than a
// rigid per-kind schema — same "jsonb, no server-side opinion on shape"
// precedent as budgets.settings/projects.health.
export const createAnnotationSchema = z.object({
  page: z.number().int().positive().optional(),
  kind: annotationKindSchema,
  geometry: z.record(z.string(), z.unknown()),
});
export type CreateAnnotationInput = z.infer<typeof createAnnotationSchema>;
