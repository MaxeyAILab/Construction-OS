import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common";

export const executiveBriefingAnomalyKindSchema = z.enum([
  "margin_erosion",
  "invoice_duplicate",
  "schedule_risk_critical",
  "schedule_risk_high",
]);
export type ExecutiveBriefingAnomalyKind = z.infer<typeof executiveBriefingAnomalyKindSchema>;

export const executiveBriefingAnomalySchema = z.object({
  kind: executiveBriefingAnomalyKindSchema,
  entityType: z.string(),
  entityId: uuidSchema,
  label: z.string(),
});
export type ExecutiveBriefingAnomaly = z.infer<typeof executiveBriefingAnomalySchema>;

export const executiveBriefingSummarySchema = z.object({
  pipelineWeightedValueAmount: z.string(),
  openFinanceAlertCount: z.number().int(),
  criticalScheduleRiskCount: z.number().int(),
  highScheduleRiskCount: z.number().int(),
  netCashFlowNext4WeeksAmount: z.string(),
  topAnomalies: z.array(executiveBriefingAnomalySchema),
});
export type ExecutiveBriefingSummary = z.infer<typeof executiveBriefingSummarySchema>;

export const executiveBriefingSchema = z.object({
  id: uuidSchema,
  generatedAt: isoDateTimeSchema,
  summary: executiveBriefingSummarySchema,
  narrative: z.string().nullable(),
  aiRunId: uuidSchema.nullable(),
});
export type ExecutiveBriefing = z.infer<typeof executiveBriefingSchema>;

export const listExecutiveBriefingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListExecutiveBriefingsQuery = z.infer<typeof listExecutiveBriefingsQuerySchema>;
