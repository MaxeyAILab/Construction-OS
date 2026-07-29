import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

// FR-FIN-6 / ai-spec.md §7.10. api.md §10's single `GET /finance/alerts`
// "margin-erosion & anomaly feed" now has two producers: MarginErosionService
// (rule+AI causal explanation) and InvoiceAnomalyService (rule-only
// duplicate-invoice detection). One physical table (finance_alerts) backs
// both — see its schema doc comment — mapped here to a discriminated union
// so a consumer never sees the other kind's irrelevant null columns.
export const financeAlertKindSchema = z.enum(["margin_erosion", "invoice_duplicate"]);
export type FinanceAlertKind = z.infer<typeof financeAlertKindSchema>;

export const financeAlertSeveritySchema = z.enum(["warning", "critical"]);
export type FinanceAlertSeverity = z.infer<typeof financeAlertSeveritySchema>;

export const invoiceDuplicateMatchReasonSchema = z.enum(["external_ref", "amount_and_date"]);
export type InvoiceDuplicateMatchReason = z.infer<typeof invoiceDuplicateMatchReasonSchema>;

const financeAlertBaseSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  severity: financeAlertSeveritySchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const marginErosionAlertSchema = financeAlertBaseSchema.extend({
  kind: z.literal("margin_erosion"),
  marginPct: z.string(),
  thresholdPct: z.string(),
  explanation: z.string().nullable(),
  aiRunId: uuidSchema.nullable(),
});
export type MarginErosionAlert = z.infer<typeof marginErosionAlertSchema>;

// Rule-only, no AI enrichment — same "nothing to explain beyond the match
// itself" precedent as compliance_alerts (InvoiceAnomalyService's own doc
// comment).
export const invoiceDuplicateAlertSchema = financeAlertBaseSchema.extend({
  kind: z.literal("invoice_duplicate"),
  invoiceId: uuidSchema,
  duplicateOfInvoiceId: uuidSchema,
  matchReason: invoiceDuplicateMatchReasonSchema,
});
export type InvoiceDuplicateAlert = z.infer<typeof invoiceDuplicateAlertSchema>;

export const financeAlertSchema = z.discriminatedUnion("kind", [marginErosionAlertSchema, invoiceDuplicateAlertSchema]);
export type FinanceAlert = z.infer<typeof financeAlertSchema>;

export const listFinanceAlertsQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  kind: financeAlertKindSchema.optional(),
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
