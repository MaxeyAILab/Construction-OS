import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

export const activityDependencyTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);
export type ActivityDependencyType = z.infer<typeof activityDependencyTypeSchema>;

export const createScheduleActivitySchema = z.object({
  wbsPath: z.string().optional(),
  name: z.string().min(1),
  durationDays: z.number().int().min(0).default(0),
  isMilestone: z.boolean().optional(),
  crew: z.record(z.string(), z.unknown()).optional(),
  costCodeId: uuidSchema.optional(),
  actualStartDate: isoDateSchema.optional(),
  actualEndDate: isoDateSchema.optional(),
  percentComplete: z.number().min(0).max(100).optional(),
});
export type CreateScheduleActivityInput = z.infer<typeof createScheduleActivitySchema>;

export const updateScheduleActivitySchema = z.object({
  wbsPath: z.string().nullable().optional(),
  name: z.string().min(1).optional(),
  durationDays: z.number().int().min(0).optional(),
  isMilestone: z.boolean().optional(),
  crew: z.record(z.string(), z.unknown()).nullable().optional(),
  costCodeId: uuidSchema.nullable().optional(),
  actualStartDate: isoDateSchema.nullable().optional(),
  actualEndDate: isoDateSchema.nullable().optional(),
  percentComplete: z.number().min(0).max(100).optional(),
});
export type UpdateScheduleActivityInput = z.infer<typeof updateScheduleActivitySchema>;

// api.md §6: "PATCH /activities:batch for drag-multiselect" — bulk update,
// capped at 500/req to mirror Estimating's own batch endpoint convention
// (api.md §5). Global convention (api.md §1.6): mutable resources carry a
// version and updates send If-Match; a batch is many resources at once, so
// each entry carries its own expected version instead of one request-level
// header.
export const batchUpdateScheduleActivitiesSchema = z.object({
  activities: z
    .array(updateScheduleActivitySchema.extend({ id: uuidSchema, ifMatchVersion: z.number().int().optional() }))
    .min(1)
    .max(500),
});
export type BatchUpdateScheduleActivitiesInput = z.infer<typeof batchUpdateScheduleActivitiesSchema>;

// api.md §6: "PUT /activities/{id}/dependencies — Replace dep set." The
// activity in the path is always the successor; each entry names one
// predecessor edge into it.
export const replaceActivityDependenciesSchema = z.object({
  dependencies: z
    .array(
      z.object({
        predecessorId: uuidSchema,
        type: activityDependencyTypeSchema.default("FS"),
        lagDays: z.number().int().default(0),
      }),
    )
    .max(500),
});
export type ReplaceActivityDependenciesInput = z.infer<typeof replaceActivityDependenciesSchema>;

export const createScheduleBaselineSchema = z.object({
  name: z.string().min(1).optional(),
});
export type CreateScheduleBaselineInput = z.infer<typeof createScheduleBaselineSchema>;

// database.md §14 (FR-SCH-5): "Crew/equipment <-> activity with tstzrange."
// No formal `crews` entity exists anywhere in the specs, so a crew
// resource is a free-form label rather than a FK (same reasoning as
// schedule_activities.crew's own jsonb label).
export const resourceTypeSchema = z.enum(["crew", "equipment"]);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const createResourceAssignmentSchema = z
  .object({
    resourceType: resourceTypeSchema,
    equipmentId: uuidSchema.optional(),
    crewLabel: z.string().min(1).optional(),
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
  })
  .refine(
    (v) => (v.resourceType === "equipment" ? !!v.equipmentId && !v.crewLabel : !!v.crewLabel && !v.equipmentId),
    { message: "equipmentId is required for resourceType 'equipment' (and vice versa for 'crew')" },
  );
export type CreateResourceAssignmentInput = z.infer<typeof createResourceAssignmentSchema>;

// api.md §6: "GET /projects/{id}/lookahead?weeks=3 | read | Lookahead view
// (FR-SCH-3)".
export const lookaheadQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(12).default(3),
});
export type LookaheadQuery = z.infer<typeof lookaheadQuerySchema>;

// api.md §6: "GET /resources/conflicts?from=&to= | schedule.resources |
// Cross-project crew/equipment conflicts (FR-SCH-5)".
export const resourceConflictsQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});
export type ResourceConflictsQuery = z.infer<typeof resourceConflictsQuerySchema>;

// --- Scheduling AI (ai-spec.md §7.5, FR-SCH-6) ---

// api.md §6: "POST /schedules/{id}/ai/impact | + AI | Delay simulation
// (FR-SCH-6): {delayed_activity_id, days} -> critical-path impact,
// affected milestones, options, confidence". `days` can be negative to
// model pulling an activity in (an acceleration what-if), not just delays.
export const simulateDelayImpactSchema = z.object({
  delayedActivityId: uuidSchema,
  days: z.number().int().refine((v) => v !== 0, "days must be nonzero"),
});
export type SimulateDelayImpactInput = z.infer<typeof simulateDelayImpactSchema>;

export const delayImpactAffectedActivitySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isMilestone: z.boolean(),
  finishShiftDays: z.number().int(),
  becameCritical: z.boolean(),
  noLongerCritical: z.boolean(),
});
export type DelayImpactAffectedActivity = z.infer<typeof delayImpactAffectedActivitySchema>;

// The critical-path/milestone impact fields are computed by re-running the
// same deterministic CPM engine that already governs
// schedule_activities.is_critical/total_float_days — never a model guess.
// `options`/`confidence` are the only AI-generated parts (FR-SCH-6's
// autonomy: "draft + suggest; schedule mutations always confirmed" — this
// endpoint writes nothing back to schedule_activities regardless).
export const delayImpactResultSchema = z.object({
  scheduleId: uuidSchema,
  delayedActivityId: uuidSchema,
  delayDays: z.number().int(),
  projectEndDelayDays: z.number().int(),
  criticalPathImpacted: z.boolean(),
  affectedActivities: z.array(delayImpactAffectedActivitySchema),
  affectedMilestones: z.array(delayImpactAffectedActivitySchema),
  options: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  aiRunId: uuidSchema.nullable(),
});
export type DelayImpactResult = z.infer<typeof delayImpactResultSchema>;
