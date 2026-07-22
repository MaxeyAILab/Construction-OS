import { z } from "zod";
import { moneyAmountSchema, paginationQuerySchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

export const projectStatusSchema = z.enum(["planning", "active", "on_hold", "closed", "warranty"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const costCodeKindSchema = z.enum([
  "labor",
  "material",
  "equipment",
  "subcontract",
  "other",
]);
export type CostCodeKind = z.infer<typeof costCodeKindSchema>;

// api.md §3: POST /projects — "optionally template_id, from_opportunity_id
// (FR-CRM-4)". from_opportunity_id is accepted here for contract fidelity
// but rejected by the service with a clear "not supported" error — the
// CRM module (M1) that owns Opportunities doesn't exist yet.
export const createProjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  clientContactCompanyId: uuidSchema.optional(),
  address: z.string().optional(),
  startDate: isoDateSchema.optional(),
  targetEndDate: isoDateSchema.optional(),
  contractValueAmount: moneyAmountSchema.optional(),
  currency: z.string().length(3).default("USD"),
  templateId: uuidSchema.optional(),
  fromOpportunityId: uuidSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  status: projectStatusSchema.optional(),
  clientContactCompanyId: uuidSchema.nullable().optional(),
  address: z.string().nullable().optional(),
  startDate: isoDateSchema.nullable().optional(),
  targetEndDate: isoDateSchema.nullable().optional(),
  actualEndDate: isoDateSchema.nullable().optional(),
  contractValueAmount: moneyAmountSchema.nullable().optional(),
  currency: z.string().length(3).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// api.md §1.5's sort/filter conventions applied to the Projects list.
export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: projectStatusSchema.optional(),
  q: z.string().optional(),
  clientContactCompanyId: uuidSchema.optional(),
  sort: z.enum(["name", "-name", "start_date", "-start_date", "created_at", "-created_at"]).default("-created_at"),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const createCostCodeSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  division: z.string().optional(),
  parentId: uuidSchema.optional(),
  kind: costCodeKindSchema,
});
export type CreateCostCodeInput = z.infer<typeof createCostCodeSchema>;

export const updateCostCodeSchema = createCostCodeSchema.partial();
export type UpdateCostCodeInput = z.infer<typeof updateCostCodeSchema>;

export const addProjectMemberSchema = z.object({
  userId: uuidSchema,
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const createMilestoneSchema = z.object({
  name: z.string().min(1),
  dueDate: isoDateSchema.optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;

export const updateMilestoneSchema = z.object({
  name: z.string().min(1).optional(),
  dueDate: isoDateSchema.nullable().optional(),
  sortOrder: z.number().int().optional(),
  completed: z.boolean().optional(),
});
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

// database.md §9: "templates store a jsonb manifest (phases, cost codes,
// checklists, folder skeleton) applied at creation (FR-PM-4)." Only
// `phases`/`costCodes` have consuming logic today (ProjectTemplatesService
// .apply) — checklists/folderSkeleton pass through unvalidated until
// Tasks (M6) / Documents (M3) exist to interpret them.
export const projectTemplateManifestSchema = z
  .object({
    phases: z.array(z.object({ name: z.string() })).optional(),
    costCodes: z
      .array(
        z.object({
          code: z.string(),
          name: z.string(),
          kind: costCodeKindSchema,
          parentCode: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
export type ProjectTemplateManifest = z.infer<typeof projectTemplateManifestSchema>;

export const createProjectTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  manifest: projectTemplateManifestSchema.default({}),
});
export type CreateProjectTemplateInput = z.infer<typeof createProjectTemplateSchema>;

// FR-PM-2: health subscores, all null until Schedule (M7)/Finance
// (M9)/Safety exist to feed them — see ProjectsService's stub.
export const projectHealthSchema = z.object({
  schedule: z.number().min(0).max(100).nullable(),
  budget: z.number().min(0).max(100).nullable(),
  safety: z.number().min(0).max(100).nullable(),
  quality: z.number().min(0).max(100).nullable(),
  overall: z.number().min(0).max(100).nullable(),
});
export type ProjectHealth = z.infer<typeof projectHealthSchema>;
