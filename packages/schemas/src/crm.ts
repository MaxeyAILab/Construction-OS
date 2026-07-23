import { z } from "zod";
import { isoDateTimeSchema, moneyAmountSchema, paginationQuerySchema, percentageSchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

// --- Contact Companies (database.md §8: external orgs, distinct from
// tenant `companies`) ---
export const createContactCompanySchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  notes: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type CreateContactCompanyInput = z.infer<typeof createContactCompanySchema>;

export const updateContactCompanySchema = createContactCompanySchema.partial();
export type UpdateContactCompanyInput = z.infer<typeof updateContactCompanySchema>;

export const listContactCompaniesQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
});
export type ListContactCompaniesQuery = z.infer<typeof listContactCompaniesQuerySchema>;

// --- Contacts ---
// database.md §8 doesn't enumerate `kind` values — a documented assumption
// of common AEC contact roles, same "shape is real, values are a
// documented assumption" treatment as daily-reports' weatherSchema.
export const contactKindSchema = z.enum(["client", "architect", "engineer", "subcontractor", "vendor", "other"]);
export type ContactKind = z.infer<typeof contactKindSchema>;

export const createContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  contactCompanyId: uuidSchema.optional(),
  kind: contactKindSchema.optional(),
  notes: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const listContactsQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  contactCompanyId: uuidSchema.optional(),
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

// --- Pipeline Stages (database.md §8: "tenant-configurable ordered
// stages") ---
export const createPipelineStageSchema = z.object({
  name: z.string().min(1),
  displayOrder: z.number().int(),
  defaultProbabilityPct: percentageSchema.optional(),
});
export type CreatePipelineStageInput = z.infer<typeof createPipelineStageSchema>;

export const updatePipelineStageSchema = createPipelineStageSchema.partial();
export type UpdatePipelineStageInput = z.infer<typeof updatePipelineStageSchema>;

// --- Opportunities ---
export const opportunityStatusSchema = z.enum(["open", "won", "lost"]);
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;

export const createOpportunitySchema = z.object({
  name: z.string().min(1),
  contactId: uuidSchema.optional(),
  contactCompanyId: uuidSchema.optional(),
  stageId: uuidSchema,
  expectedValueAmount: moneyAmountSchema.optional(),
  currency: z.string().length(3).optional(),
  probability: percentageSchema.optional(),
  expectedCloseDate: isoDateSchema.optional(),
  source: z.string().optional(),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

// api.md §4: "Stage moves audited" — a stage move is just a PATCH with a
// new stageId, same generic-update reasoning as project.updated.v1/
// daily_report.updated.v1 (one event, changedFields tells you what).
export const updateOpportunitySchema = z.object({
  name: z.string().min(1).optional(),
  contactId: uuidSchema.nullable().optional(),
  contactCompanyId: uuidSchema.nullable().optional(),
  stageId: uuidSchema.optional(),
  expectedValueAmount: moneyAmountSchema.optional(),
  currency: z.string().length(3).optional(),
  probability: percentageSchema.nullable().optional(),
  expectedCloseDate: isoDateSchema.nullable().optional(),
  source: z.string().nullable().optional(),
});
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const listOpportunitiesQuerySchema = paginationQuerySchema.extend({
  stageId: uuidSchema.optional(),
  status: opportunityStatusSchema.optional(),
  closeDateBefore: isoDateSchema.optional(),
  closeDateAfter: isoDateSchema.optional(),
});
export type ListOpportunitiesQuery = z.infer<typeof listOpportunitiesQuerySchema>;

// FR-CRM-4 / api.md §4: "Atomic: marks won, creates project (+links
// estimate). Body: {project: {code, start_date…}}". Only `code` is
// required — everything else the new project needs (name, currency,
// contractValueAmount, clientContactCompanyId) is derived from the
// opportunity itself by OpportunitiesService.win(), the "zero re-entry"
// FR-CRM-4 calls for.
export const winOpportunitySchema = z.object({
  project: z.object({
    code: z.string().min(1),
    startDate: isoDateSchema.optional(),
    targetEndDate: isoDateSchema.optional(),
    templateId: uuidSchema.optional(),
  }),
});
export type WinOpportunityInput = z.infer<typeof winOpportunitySchema>;

export const loseOpportunitySchema = z.object({
  lostReason: z.string().min(1),
});
export type LoseOpportunityInput = z.infer<typeof loseOpportunitySchema>;

// --- Activities (database.md §8: polymorphic timeline; only the
// opportunity-scoped endpoint is wired this pass — api.md §4) ---
export const activityKindSchema = z.enum(["call", "email", "meeting", "note"]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const createActivitySchema = z.object({
  kind: activityKindSchema,
  subject: z.string().optional(),
  body: z.string().optional(),
  occurredAt: isoDateTimeSchema.optional(),
});
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
