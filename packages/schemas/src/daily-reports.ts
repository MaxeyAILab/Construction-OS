import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

// database.md §15 (M8): "weather jsonb (auto-filled + editable)". No
// weather-provider integration is wired up this pass (same "flagged, not
// built" treatment as the QuickBooks credential gap) — shape is a
// documented assumption, manually entered/edited only until a provider +
// API key exist to auto-fill it.
export const weatherSchema = z.object({
  conditions: z.string().optional(),
  tempHighF: z.number().optional(),
  tempLowF: z.number().optional(),
  precipitationIn: z.number().optional(),
  windMph: z.number().optional(),
  notes: z.string().optional(),
});
export type Weather = z.infer<typeof weatherSchema>;

export const dailyReportStatusSchema = z.enum(["draft", "submitted"]);
export type DailyReportStatus = z.infer<typeof dailyReportStatusSchema>;

// FR-FIELD-1/FR-FIELD-4: created on-device, offline-first — mobile mints
// the id (database.md §15's "client-generated UUID" note), same explicitId
// convention as tasks.create.
export const createDailyReportSchema = z.object({
  projectId: uuidSchema,
  reportDate: isoDateSchema,
  weather: weatherSchema.optional(),
  narrative: z.string().optional(),
});
export type CreateDailyReportInput = z.infer<typeof createDailyReportSchema>;

// Draft-only edits (mirrors change-orders.ts's pattern) — status may only
// move draft -> submitted, enforced in the service, not here.
export const updateDailyReportSchema = z.object({
  weather: weatherSchema.nullable().optional(),
  narrative: z.string().nullable().optional(),
  status: dailyReportStatusSchema.optional(),
});
export type UpdateDailyReportInput = z.infer<typeof updateDailyReportSchema>;

export const listDailyReportsQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  status: dailyReportStatusSchema.optional(),
  reportDateBefore: isoDateSchema.optional(),
  reportDateAfter: isoDateSchema.optional(),
});
export type ListDailyReportsQuery = z.infer<typeof listDailyReportsQuerySchema>;

export const timeEntryKindSchema = z.enum(["regular", "overtime"]);
export type TimeEntryKind = z.infer<typeof timeEntryKindSchema>;

// database.md §15: "Append-only ... user_id (or crew_labels)" — one or the
// other identifies who the hours belong to.
export const createTimeEntrySchema = z
  .object({
    dailyReportId: uuidSchema.optional(),
    projectId: uuidSchema,
    userId: uuidSchema.optional(),
    crewLabel: z.string().min(1).optional(),
    costCodeId: uuidSchema,
    hours: z.number().positive().max(24),
    workDate: isoDateSchema,
    kind: timeEntryKindSchema.optional(),
  })
  .refine((v) => Boolean(v.userId) || Boolean(v.crewLabel), {
    message: "either userId or crewLabel is required",
    path: ["userId"],
  });
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;

export const listTimeEntriesQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  dailyReportId: uuidSchema.optional(),
  workDateBefore: isoDateSchema.optional(),
  workDateAfter: isoDateSchema.optional(),
});
export type ListTimeEntriesQuery = z.infer<typeof listTimeEntriesQuerySchema>;

// api.md §9: `GET /daily-reports/{id}/ai-summary` — "Generated narrative
// (FR-FIELD-6) with edit-before-submit." Draft-only: the narrative here is
// never written to daily_reports.narrative (the field the crew lead
// actually submits) — it's a suggestion the UI shows alongside that field
// for the user to copy-edit in, same "never auto-applies" autonomy rule as
// Estimator AI/Photo AI's defect drafts.
export const dailyReportAiSummarySchema = z.object({
  narrative: z.string(),
  confidence: z.number().min(0).max(1),
  aiRunId: uuidSchema,
});
export type DailyReportAiSummary = z.infer<typeof dailyReportAiSummarySchema>;
