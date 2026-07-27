import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");
const isoDateTimeSchema = z.string().datetime({ offset: true });

// --- Safety form templates (database.md §15; FR-SAFE-1) ---
export const safetyFormTemplateKindSchema = z.enum(["toolbox_talk", "inspection"]);
export type SafetyFormTemplateKind = z.infer<typeof safetyFormTemplateKindSchema>;

export const createSafetyFormTemplateSchema = z.object({
  name: z.string().min(1),
  kind: safetyFormTemplateKindSchema,
  schema: z.record(z.string(), z.unknown()),
  active: z.boolean().optional(),
});
export type CreateSafetyFormTemplateInput = z.infer<typeof createSafetyFormTemplateSchema>;

// --- Safety forms: filled instances (database.md §15; FR-SAFE-1) ---
// Created on-device, offline-first — same explicitId convention as
// tasks.create/dailyReports.create (mobile mints the id; REST callers
// never pass one).
export const createSafetyFormSchema = z.object({
  templateId: uuidSchema,
  responses: z.record(z.string(), z.unknown()),
  signatures: z.record(z.string(), z.unknown()).optional(),
});
export type CreateSafetyFormInput = z.infer<typeof createSafetyFormSchema>;

export const listSafetyFormsQuerySchema = paginationQuerySchema.extend({
  templateId: uuidSchema.optional(),
});
export type ListSafetyFormsQuery = z.infer<typeof listSafetyFormsQuerySchema>;

// --- Incidents (database.md §15; FR-SAFE-1/FR-SAFE-3) ---
export const incidentKindSchema = z.enum(["incident", "near_miss", "observation"]);
export type IncidentKind = z.infer<typeof incidentKindSchema>;

// database.md doesn't enumerate severity's values — low/medium/high/
// critical is a documented assumption, same treatment as tasks.priority.
export const incidentSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>;

export const incidentStatusSchema = z.enum(["open", "closed"]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const createIncidentSchema = z.object({
  kind: incidentKindSchema,
  severity: incidentSeveritySchema.optional(),
  occurredAt: isoDateTimeSchema,
  location: z.string().optional(),
  description: z.string().optional(),
  people: z.array(z.record(z.string(), z.unknown())).optional(),
  oshaRecordable: z.boolean().optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = z.object({
  severity: incidentSeveritySchema.optional(),
  status: incidentStatusSchema.optional(),
  description: z.string().nullable().optional(),
  oshaRecordable: z.boolean().optional(),
});
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;

// FR-SAFE-3: "route incidents to corrective actions" — creates a Task
// (cross-module reuse of TasksService, same precedent as StockService
// reusing CostTransactionsService) and stamps corrective_action_task_id.
export const routeIncidentCorrectiveActionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: uuidSchema.optional(),
  dueDate: isoDateSchema.optional(),
});
export type RouteIncidentCorrectiveActionInput = z.infer<typeof routeIncidentCorrectiveActionSchema>;

export const listIncidentsQuerySchema = paginationQuerySchema.extend({
  kind: incidentKindSchema.optional(),
  severity: incidentSeveritySchema.optional(),
  status: incidentStatusSchema.optional(),
});
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

// --- Certifications (database.md §15; FR-SAFE-2) ---
export const createCertificationSchema = z.object({
  holderUserId: uuidSchema.optional(),
  holderName: z.string().min(1),
  certType: z.string().min(1),
  issuedAt: isoDateSchema.optional(),
  expiresAt: isoDateSchema.optional(),
});
export type CreateCertificationInput = z.infer<typeof createCertificationSchema>;

export const updateCertificationSchema = z.object({
  holderName: z.string().min(1).optional(),
  certType: z.string().min(1).optional(),
  issuedAt: isoDateSchema.nullable().optional(),
  expiresAt: isoDateSchema.nullable().optional(),
});
export type UpdateCertificationInput = z.infer<typeof updateCertificationSchema>;

export const listCertificationsQuerySchema = paginationQuerySchema.extend({
  holderUserId: uuidSchema.optional(),
  // FR-SAFE-2: "expiry alerts" — server computes each row's due-state
  // (valid/expiring_soon/expired) on read, same projection pattern as
  // Equipment's maintenance due-state; this flag filters to the ones
  // worth surfacing as an alert feed.
  expiringOnly: z.coerce.boolean().optional(),
});
export type ListCertificationsQuery = z.infer<typeof listCertificationsQuerySchema>;
