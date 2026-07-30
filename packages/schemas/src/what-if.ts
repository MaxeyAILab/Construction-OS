import { z } from "zod";
import { uuidSchema } from "./common";

export const whatIfBidLossInputSchema = z.object({
  type: z.literal("bid_loss"),
  opportunityId: uuidSchema,
});
export type WhatIfBidLossInput = z.infer<typeof whatIfBidLossInputSchema>;

export const whatIfCrewMoveInputSchema = z.object({
  type: z.literal("crew_move"),
  scheduleId: uuidSchema,
  resourceAssignmentIds: z.array(uuidSchema).min(1).max(20),
  targetActivityId: uuidSchema.optional(),
});
export type WhatIfCrewMoveInput = z.infer<typeof whatIfCrewMoveInputSchema>;

export const whatIfDelayCascadeInputSchema = z.object({
  type: z.literal("delay_cascade"),
  scheduleId: uuidSchema,
  delays: z.array(z.object({ activityId: uuidSchema, days: z.number().int() })).min(1).max(20),
});
export type WhatIfDelayCascadeInput = z.infer<typeof whatIfDelayCascadeInputSchema>;

export const simulateWhatIfInputSchema = z.discriminatedUnion("type", [
  whatIfBidLossInputSchema,
  whatIfCrewMoveInputSchema,
  whatIfDelayCascadeInputSchema,
]);
export type SimulateWhatIfInput = z.infer<typeof simulateWhatIfInputSchema>;

const whatIfAffectedActivitySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isMilestone: z.boolean(),
  finishShiftDays: z.number().int(),
  becameCritical: z.boolean(),
  noLongerCritical: z.boolean(),
});
export type WhatIfAffectedActivity = z.infer<typeof whatIfAffectedActivitySchema>;

export const whatIfBidLossResultSchema = z.object({
  type: z.literal("bid_loss"),
  opportunityId: uuidSchema,
  opportunityName: z.string(),
  lostWeightedValueAmount: z.string(),
  pipelineWeightedValueBefore: z.string(),
  pipelineWeightedValueAfter: z.string(),
  pipelineWeightedValueDeltaPct: z.number(),
  narrative: z.string().nullable(),
  aiRunId: z.string().nullable(),
});
export type WhatIfBidLossResult = z.infer<typeof whatIfBidLossResultSchema>;

export const whatIfCrewMoveResultSchema = z.object({
  type: z.literal("crew_move"),
  scheduleId: uuidSchema,
  movedAssignments: z.array(
    z.object({
      resourceAssignmentId: uuidSchema,
      fromActivityId: uuidSchema,
      fromActivityName: z.string(),
      lostDays: z.number().int(),
    }),
  ),
  targetActivityId: uuidSchema.nullable(),
  newConflicts: z.array(
    z.object({
      resourceAssignmentId: uuidSchema,
      conflictingAssignmentId: uuidSchema,
    }),
  ),
  projectEndDelayDays: z.number().int(),
  criticalPathImpacted: z.boolean(),
  affectedActivities: z.array(whatIfAffectedActivitySchema),
  narrative: z.string().nullable(),
  aiRunId: z.string().nullable(),
});
export type WhatIfCrewMoveResult = z.infer<typeof whatIfCrewMoveResultSchema>;

export const whatIfDelayCascadeResultSchema = z.object({
  type: z.literal("delay_cascade"),
  scheduleId: uuidSchema,
  projectEndDelayDays: z.number().int(),
  criticalPathImpacted: z.boolean(),
  affectedActivities: z.array(whatIfAffectedActivitySchema),
  affectedMilestones: z.array(whatIfAffectedActivitySchema),
  narrative: z.string().nullable(),
  aiRunId: z.string().nullable(),
});
export type WhatIfDelayCascadeResult = z.infer<typeof whatIfDelayCascadeResultSchema>;

export const whatIfSimulationResultSchema = z.discriminatedUnion("type", [
  whatIfBidLossResultSchema,
  whatIfCrewMoveResultSchema,
  whatIfDelayCascadeResultSchema,
]);
export type WhatIfSimulationResult = z.infer<typeof whatIfSimulationResultSchema>;
