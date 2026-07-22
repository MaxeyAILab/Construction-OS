import { z } from "zod";
import { uuidSchema } from "./common";

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
