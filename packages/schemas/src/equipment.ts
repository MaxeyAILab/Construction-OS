import { z } from "zod";
import { moneyAmountSchema, paginationQuerySchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");
const isoDateTimeSchema = z.string().datetime({ offset: true });
// database.md §13: hours NUMERIC(5,2).
const hoursSchema = z.string().regex(/^\d{1,3}\.\d{2}$/, "hours must be a decimal string with exactly 2 places");
// odometer/last_service_hours NUMERIC(10,2).
const odometerSchema = z.string().regex(/^\d{1,8}\.\d{2}$/, "odometer must be a decimal string with exactly 2 places");

// --- Equipment registry (database.md §13; FR-EQ-1) ---
export const equipmentOwnershipSchema = z.enum(["owned", "rented", "leased"]);
export type EquipmentOwnership = z.infer<typeof equipmentOwnershipSchema>;

export const equipmentStatusSchema = z.enum(["available", "assigned", "maintenance", "retired"]);
export type EquipmentStatus = z.infer<typeof equipmentStatusSchema>;

export const createEquipmentSchema = z.object({
  assetNo: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  ownership: equipmentOwnershipSchema.optional(),
  hourlyCostRateAmount: moneyAmountSchema.optional(),
  dailyCostRateAmount: moneyAmountSchema.optional(),
});
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

// status isn't patchable directly here — 'assigned'/'available' are
// derived from equipment_assignments (AssignmentsService.create/end);
// only 'maintenance'/'retired' make sense as a direct operator action.
export const updateEquipmentSchema = createEquipmentSchema.partial().extend({
  status: z.enum(["maintenance", "retired", "available"]).optional(),
});
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;

export const listEquipmentQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  status: equipmentStatusSchema.optional(),
  category: z.string().optional(),
});
export type ListEquipmentQuery = z.infer<typeof listEquipmentQuerySchema>;

// --- Assignments (database.md §13; FR-EQ-1: DB exclusion prevents
// double-booking, surfaced as a 409 "overlap" per api.md §11) ---
export const createEquipmentAssignmentSchema = z.object({
  projectId: uuidSchema,
  startAt: isoDateTimeSchema.optional(),
  endAt: isoDateTimeSchema.optional(),
});
export type CreateEquipmentAssignmentInput = z.infer<typeof createEquipmentAssignmentSchema>;

// --- Usage logs (database.md §13; FR-EQ-2) ---
export const createEquipmentUsageLogSchema = z.object({
  projectId: uuidSchema.optional(),
  costCodeId: uuidSchema.optional(),
  operatorId: uuidSchema.optional(),
  workDate: isoDateSchema,
  hours: hoursSchema.optional(),
  odometer: odometerSchema.optional(),
});
export type CreateEquipmentUsageLogInput = z.infer<typeof createEquipmentUsageLogSchema>;

export const listEquipmentUsageLogsQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
});
export type ListEquipmentUsageLogsQuery = z.infer<typeof listEquipmentUsageLogsQuerySchema>;

// --- Maintenance: schedules, work orders, inspections (database.md §13;
// FR-EQ-3) ---
export const maintenanceRecurrenceTypeSchema = z.enum(["hours", "days"]);
export type MaintenanceRecurrenceType = z.infer<typeof maintenanceRecurrenceTypeSchema>;

export const createMaintenanceScheduleSchema = z.object({
  name: z.string().min(1),
  recurrenceType: maintenanceRecurrenceTypeSchema,
  recurrenceValue: z.number().int().positive(),
  lastServiceDate: isoDateSchema.optional(),
  lastServiceHours: odometerSchema.optional(),
});
export type CreateMaintenanceScheduleInput = z.infer<typeof createMaintenanceScheduleSchema>;

export const maintenanceWorkOrderStatusSchema = z.enum(["open", "in_progress", "completed", "cancelled"]);
export type MaintenanceWorkOrderStatus = z.infer<typeof maintenanceWorkOrderStatusSchema>;

export const maintenanceCostAllocationSchema = z.enum(["overhead", "project"]);
export type MaintenanceCostAllocation = z.infer<typeof maintenanceCostAllocationSchema>;

export const createMaintenanceWorkOrderSchema = z.object({
  maintenanceScheduleId: uuidSchema.optional(),
  description: z.string().optional(),
  costAllocation: maintenanceCostAllocationSchema.optional(),
  projectId: uuidSchema.optional(),
  costCodeId: uuidSchema.optional(),
});
export type CreateMaintenanceWorkOrderInput = z.infer<typeof createMaintenanceWorkOrderSchema>;

// Draft-ish header edits plus the parts/labor costs an ops person fills
// in as the work order progresses — status moves through the same PATCH
// (no separate lifecycle actions; FR-EQ-3 doesn't call for anything more
// than a simple status field, unlike PO/change-order lifecycles).
export const updateMaintenanceWorkOrderSchema = z.object({
  status: maintenanceWorkOrderStatusSchema.optional(),
  description: z.string().nullable().optional(),
  partsCostAmount: moneyAmountSchema.optional(),
  laborCostAmount: moneyAmountSchema.optional(),
});
export type UpdateMaintenanceWorkOrderInput = z.infer<typeof updateMaintenanceWorkOrderSchema>;

export const createEquipmentInspectionSchema = z.object({
  inspectorId: uuidSchema.optional(),
  inspectionDate: isoDateSchema,
  checklist: z.record(z.string(), z.unknown()).optional(),
  passed: z.boolean().optional(),
  notes: z.string().optional(),
});
export type CreateEquipmentInspectionInput = z.infer<typeof createEquipmentInspectionSchema>;

// --- Equipment AI: insights feed (ai-spec.md §7.6, FR-EQ-4). api.md §11:
// "GET /equipment/ai/insights | Idle assets, predictive maintenance,
// rent-vs-buy". idle_asset/maintenance_due/rent_vs_buy are a pure
// deterministic feed, no AI Gateway call — same "recommendations list"
// shape/precedent as procurement's suggest-lines/recommendations and
// inventory's reorder-suggestions (both zero-AI-call feeds). "usage-hours
// vs service intervals" is already fully covered by MaintenanceService's
// existing due-state projection (FR-EQ-3), reused as-is rather than
// duplicated. fault_pattern is the exception: it surfaces persisted
// equipment_fault_alerts rows (EquipmentFaultAlertsService, triggered off
// equipment_inspection.created.v1) — the one insight kind an AI Gateway
// call actually produces, since judging whether failed inspections share
// a genuine recurring cause requires reading the notes, not just counting
// them.
export const equipmentInsightSuggestedActionSchema = z.enum(["reassign", "return"]);
export type EquipmentInsightSuggestedAction = z.infer<typeof equipmentInsightSuggestedActionSchema>;

export const idleAssetInsightSchema = z.object({
  kind: z.literal("idle_asset"),
  equipmentId: uuidSchema,
  assetNo: z.string(),
  name: z.string(),
  ownership: equipmentOwnershipSchema,
  idleDays: z.number().int(),
  lastProjectId: uuidSchema.nullable(),
  // ai-spec.md §7.6: "idle-asset detection with reassignment/return
  // suggestions" — owned idle equipment should be reassigned; rented/
  // leased idle equipment should be returned to stop paying for it.
  suggestedAction: equipmentInsightSuggestedActionSchema,
});
export type IdleAssetInsight = z.infer<typeof idleAssetInsightSchema>;

export const maintenanceDueInsightSchema = z.object({
  kind: z.literal("maintenance_due"),
  equipmentId: uuidSchema,
  assetNo: z.string(),
  name: z.string(),
  maintenanceScheduleId: uuidSchema,
  scheduleName: z.string(),
  dueState: z.enum(["due_soon", "overdue"]),
  recurrenceType: maintenanceRecurrenceTypeSchema,
  remaining: z.number(),
});
export type MaintenanceDueInsight = z.infer<typeof maintenanceDueInsightSchema>;

export const equipmentInsightRecommendationSchema = z.enum(["consider_buying", "consider_returning", "monitor"]);
export type EquipmentInsightRecommendation = z.infer<typeof equipmentInsightRecommendationSchema>;

export const rentVsBuyInsightSchema = z.object({
  kind: z.literal("rent_vs_buy"),
  equipmentId: uuidSchema,
  assetNo: z.string(),
  name: z.string(),
  ownership: z.enum(["rented", "leased"]),
  utilizationPct: z.number(),
  windowDays: z.number().int(),
  recommendation: equipmentInsightRecommendationSchema,
});
export type RentVsBuyInsight = z.infer<typeof rentVsBuyInsightSchema>;

// Backed by a persisted equipment_fault_alerts row (EquipmentFaultAlertsService)
// rather than computed live — see that service's doc comment for why
// there's no rule-only fallback: the AI's read of the inspection notes is
// what decides whether a "pattern" exists at all.
export const faultPatternInsightSchema = z.object({
  kind: z.literal("fault_pattern"),
  equipmentId: uuidSchema,
  assetNo: z.string(),
  name: z.string(),
  description: z.string(),
  failedInspectionCount: z.number().int(),
  windowDays: z.number().int(),
});
export type FaultPatternInsight = z.infer<typeof faultPatternInsightSchema>;

export const equipmentInsightSchema = z.discriminatedUnion("kind", [
  idleAssetInsightSchema,
  maintenanceDueInsightSchema,
  rentVsBuyInsightSchema,
  faultPatternInsightSchema,
]);
export type EquipmentInsight = z.infer<typeof equipmentInsightSchema>;

export const equipmentInsightsResponseSchema = z.object({
  insights: z.array(equipmentInsightSchema),
});
export type EquipmentInsightsResponse = z.infer<typeof equipmentInsightsResponseSchema>;
