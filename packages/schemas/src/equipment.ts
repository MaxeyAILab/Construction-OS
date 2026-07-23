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
