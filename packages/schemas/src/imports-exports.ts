import { z } from "zod";
import { uuidSchema } from "./common";

// api.md §14: "GET /exports/{entity} — Full CSV export per entity (FR-PLAT-7,
// A8 no lock-in) — 202 job." v1's entity registry — see exporters.ts's own
// comment for why this list stops here rather than covering every table.
export const exportEntityTypeSchema = z.enum([
  "projects",
  "cost_codes",
  "budget_lines",
  "change_orders",
  "rfis",
  "tasks",
]);
export type ExportEntityType = z.infer<typeof exportEntityTypeSchema>;

// api.md §14: "POST /imports: Guided import: upload -> POST /imports/{id}/map
// -> /validate (dry-run report) -> /commit (202)." v1 supports cost_codes
// only — see import_jobs' schema comment (dashboards.ts's sibling table) for
// why parent-hierarchy resolution isn't in this pass.
export const importEntityTypeSchema = z.enum(["cost_codes"]);
export type ImportEntityType = z.infer<typeof importEntityTypeSchema>;

export const createImportJobSchema = z.object({
  entityType: importEntityTypeSchema,
  // Required for every entity type v1 supports (cost_codes is project-
  // scoped) — becomes optional again once a tenant-wide entity type exists.
  projectId: uuidSchema,
  // The already-uploaded, already-virus-scanned CSV (Files module's
  // existing initiate/complete-upload flow — reused as-is, not rebuilt).
  fileId: uuidSchema,
});
export type CreateImportJobInput = z.infer<typeof createImportJobSchema>;

// { [targetField]: sourceColumnHeader } — e.g. { code: "Cost Code",
// name: "Description", kind: "Type" }. Only createCostCodeSchema's own
// fields (minus parentId, not supported this pass) are valid targets;
// enforced in ImportsService, not in this shape (it's a plain string map).
export const mapImportJobSchema = z.object({
  fieldMapping: z.record(z.string(), z.string().min(1)),
});
export type MapImportJobInput = z.infer<typeof mapImportJobSchema>;

export const importRowErrorSchema = z.object({
  row: z.number().int(),
  field: z.string().optional(),
  message: z.string(),
});
export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const importValidationReportSchema = z.object({
  totalRows: z.number().int(),
  validRows: z.number().int(),
  errors: z.array(importRowErrorSchema),
});
export type ImportValidationReport = z.infer<typeof importValidationReportSchema>;

export const importCommitResultSchema = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(importRowErrorSchema),
});
export type ImportCommitResult = z.infer<typeof importCommitResultSchema>;
