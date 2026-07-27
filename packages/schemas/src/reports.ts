import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

// api.md §14 (M16 Reports & Dashboards): "GET/POST/PATCH /reports/definitions
// | Saved/scheduled reports (FR-EXEC-2)." v1 supports two kinds, both
// backed by DashboardsService's existing aggregates (see
// ReportRunnerService's doc comment) — a report formalizes an existing
// dashboard view into a durable, downloadable artifact rather than
// inventing new business-report types nothing else in this codebase
// defines.
export const reportKindSchema = z.enum(["company_summary", "project_summary"]);
export type ReportKind = z.infer<typeof reportKindSchema>;

const recipientsSchema = z.array(z.string().email()).max(20);

export const createReportDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({
    name: z.string().min(1),
    kind: z.literal("company_summary"),
    // Stored per database.md §21's field list but not yet dispatched —
    // no cron-trigger executor exists this pass (flagged, not built).
    schedule: z.string().min(1).optional(),
    recipients: recipientsSchema.optional(),
  }),
  z.object({
    name: z.string().min(1),
    kind: z.literal("project_summary"),
    params: z.object({ projectId: uuidSchema }),
    schedule: z.string().min(1).optional(),
    recipients: recipientsSchema.optional(),
  }),
]);
export type CreateReportDefinitionInput = z.infer<typeof createReportDefinitionSchema>;

// name/schedule/recipients only — kind/params define what the report
// computes and stay fixed at creation, same "identity is immutable"
// precedent as Project Assistant's entityRef.
export const updateReportDefinitionSchema = z.object({
  name: z.string().min(1).optional(),
  schedule: z.string().min(1).nullable().optional(),
  recipients: recipientsSchema.nullable().optional(),
});
export type UpdateReportDefinitionInput = z.infer<typeof updateReportDefinitionSchema>;

export const listReportDefinitionsQuerySchema = paginationQuerySchema;
export type ListReportDefinitionsQuery = z.infer<typeof listReportDefinitionsQuerySchema>;
