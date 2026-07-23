import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

// FR-FIN-6 / ai-spec.md §7.10. Only 'margin_erosion' fires this pass — the
// broader "anomaly feed" api.md §10's GET /finance/alerts describes
// (invoice anomaly detection, etc.) has no producer yet.
export const financeAlertKindSchema = z.enum(["margin_erosion"]);
export type FinanceAlertKind = z.infer<typeof financeAlertKindSchema>;

export const financeAlertSeveritySchema = z.enum(["warning", "critical"]);
export type FinanceAlertSeverity = z.infer<typeof financeAlertSeveritySchema>;

export const listFinanceAlertsQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
});
export type ListFinanceAlertsQuery = z.infer<typeof listFinanceAlertsQuerySchema>;

// Read from projects.settings.marginAlerts (a generic jsonb bag already
// patchable via the existing PATCH /projects/{id} — FR-FIN-6's
// "configurable thresholds" reuses that endpoint rather than inventing a
// new one api.md doesn't document). Absent/invalid settings fall back to
// MarginErosionService's defaults.
export const marginAlertSettingsSchema = z.object({
  warningThresholdPct: z.number().min(0).max(100).optional(),
  criticalThresholdPct: z.number().min(0).max(100).optional(),
});
export type MarginAlertSettings = z.infer<typeof marginAlertSettingsSchema>;
