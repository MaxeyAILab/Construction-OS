import { Inject, Injectable } from "@nestjs/common";
import type { ActivityDependencyType, DelayImpactResult, SimulateDelayImpactInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { scheduleActivities } from "../../../infrastructure/db/schema";
import { AiGatewayService, type AiToolSpec } from "../../ai";
import { runCpm } from "../domain/cpm";
import { ScheduleActivityNotFoundError } from "../domain/errors";
import { SchedulesService } from "./schedules.service";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 500;
const TOOL_NAME = "emit_delay_mitigation_options";

const emitOptionsInputSchema = z.object({
  options: z.array(z.string().min(1)).min(1).max(4),
});

// Deterministic fallback when the AI call fails/is unconfigured — a
// delay-impact response must never come back empty just because a model
// call did, same "the analysis is still useful without the model"
// tolerance as MarginErosionService's explanation and
// ProcurementNeedsService's rationale.
const FALLBACK_OPTIONS = [
  "Crash the delayed activity (add crews/shifts/equipment) to recover the lost days.",
  "Resequence downstream non-critical work to run in parallel where dependencies allow.",
  "Negotiate schedule relief with the client/owner if the delay is unavoidable.",
];

const SYSTEM_PROMPT =
  "You are a construction scheduler. Given a delayed activity, how many days it slipped, the resulting project-end impact, and which downstream activities/milestones are affected, propose 2-4 concrete, practical mitigation options a project manager could act on this week. Reason only from the facts given — do not invent scope or resources that weren't mentioned.";

// ai-spec.md §7.5 (Scheduling AI, M7) / FR-SCH-6: "delay-impact simulation."
// The critical-path/milestone math is the existing, already-tested CPM
// engine (domain/cpm.ts) run twice — once on the schedule as-is, once with
// the named activity's duration extended by `days` (the only lever a
// duration-driven CPM model has for "this activity is taking N days
// longer") — never a model guess, same "the rule computes the fact, AI
// only narrates it" split as every other AI feature this session
// (MarginErosionService, ProcurementNeedsService). Nothing is written back
// to schedule_activities — FR-SCH-6's autonomy is "draft + suggest;
// schedule mutations always confirmed," and a real re-plan still goes
// through the existing RecalculateService/batch-update endpoints.
//
// Deliberately narrower than ai-spec §7.5's full capability list:
// auto-sequencing-from-template, weather-aware lookahead adjustment, and
// crew-conflict resolution options have no dedicated api.md endpoint (only
// this one delay-impact row is documented) — flagged follow-ups, not
// silently built here.
@Injectable()
export class DelayImpactService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly schedules: SchedulesService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async simulateImpact(
    tenantId: string,
    actorId: string,
    scheduleId: string,
    input: SimulateDelayImpactInput,
  ): Promise<DelayImpactResult> {
    const { activityRows, dependencyInputs, delayed } = await withTenant(this.db, tenantId, async (tx) => {
      await this.schedules.requireSchedule(tx, scheduleId);
      const rows = await tx.query.scheduleActivities.findMany({
        where: and(eq(scheduleActivities.scheduleId, scheduleId), isNull(scheduleActivities.deletedAt)),
      });
      const found = rows.find((a) => a.id === input.delayedActivityId);
      if (!found) throw new ScheduleActivityNotFoundError();

      const dependencyRows = await this.schedules.loadDependencies(tx, scheduleId);
      return {
        activityRows: rows,
        dependencyInputs: dependencyRows.map((d) => ({
          predecessorId: d.predecessorId,
          successorId: d.successorId,
          type: d.type as ActivityDependencyType,
          lagDays: d.lagDays,
        })),
        delayed: found,
      };
    });

    const baselineInputs = activityRows.map((a) => ({ id: a.id, durationDays: a.durationDays }));
    const before = runCpm(baselineInputs, dependencyInputs);

    const whatIfInputs = baselineInputs.map((a) =>
      a.id === input.delayedActivityId ? { ...a, durationDays: Math.max(0, a.durationDays + input.days) } : a,
    );
    const after = runCpm(whatIfInputs, dependencyInputs);

    const beforeProjectEnd = Math.max(...[...before.values()].map((r) => r.earlyFinish));
    const afterProjectEnd = Math.max(...[...after.values()].map((r) => r.earlyFinish));
    const projectEndDelayDays = afterProjectEnd - beforeProjectEnd;

    const affectedActivities = activityRows
      .map((activity) => {
        const b = before.get(activity.id)!;
        const a = after.get(activity.id)!;
        if (b.earlyFinish === a.earlyFinish && b.isCritical === a.isCritical) return null;
        return {
          id: activity.id,
          name: activity.name,
          isMilestone: activity.isMilestone,
          finishShiftDays: a.earlyFinish - b.earlyFinish,
          becameCritical: !b.isCritical && a.isCritical,
          noLongerCritical: b.isCritical && !a.isCritical,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const affectedMilestones = affectedActivities.filter((a) => a.isMilestone);

    const { options, aiRunId, confidence } = await this.explainImpact(
      tenantId,
      actorId,
      delayed.name,
      input.days,
      projectEndDelayDays,
      affectedActivities,
    );

    return {
      scheduleId,
      delayedActivityId: input.delayedActivityId,
      delayDays: input.days,
      projectEndDelayDays,
      criticalPathImpacted: projectEndDelayDays !== 0,
      affectedActivities,
      affectedMilestones,
      options,
      confidence,
      aiRunId,
    };
  }

  // Reused by WhatIfSimulationService (dashboards module, FR-EXEC-4 "delay
  // cascade" / "crew move" what-if scenarios) — the same "extend duration,
  // re-run CPM once, diff before/after" math as simulateImpact above,
  // generalized to N simultaneous activity delays instead of one. Kept as
  // its own method rather than refactoring simulateImpact to call this with
  // a single-element array: simulateImpact's own AI narrative step is
  // scheduling-specific (mitigation *options*), while the what-if caller's
  // narrative is a different, exec-level sketch — no shared caller to
  // justify the extra indirection. No AI Gateway call here: narration is
  // the caller's concern, this method only returns the deterministic CPM
  // diff.
  async simulateCascade(
    tenantId: string,
    scheduleId: string,
    delays: Array<{ activityId: string; days: number }>,
  ): Promise<{
    scheduleId: string;
    projectEndDelayDays: number;
    criticalPathImpacted: boolean;
    affectedActivities: Array<{
      id: string;
      name: string;
      isMilestone: boolean;
      finishShiftDays: number;
      becameCritical: boolean;
      noLongerCritical: boolean;
    }>;
    affectedMilestones: Array<{
      id: string;
      name: string;
      isMilestone: boolean;
      finishShiftDays: number;
      becameCritical: boolean;
      noLongerCritical: boolean;
    }>;
  }> {
    const { activityRows, dependencyInputs } = await withTenant(this.db, tenantId, async (tx) => {
      await this.schedules.requireSchedule(tx, scheduleId);
      const rows = await tx.query.scheduleActivities.findMany({
        where: and(eq(scheduleActivities.scheduleId, scheduleId), isNull(scheduleActivities.deletedAt)),
      });
      const rowIds = new Set(rows.map((r) => r.id));
      for (const delay of delays) {
        if (!rowIds.has(delay.activityId)) throw new ScheduleActivityNotFoundError();
      }

      const dependencyRows = await this.schedules.loadDependencies(tx, scheduleId);
      return {
        activityRows: rows,
        dependencyInputs: dependencyRows.map((d) => ({
          predecessorId: d.predecessorId,
          successorId: d.successorId,
          type: d.type as ActivityDependencyType,
          lagDays: d.lagDays,
        })),
      };
    });

    const extraDaysByActivity = new Map(delays.map((d) => [d.activityId, d.days]));
    const baselineInputs = activityRows.map((a) => ({ id: a.id, durationDays: a.durationDays }));
    const before = runCpm(baselineInputs, dependencyInputs);

    const whatIfInputs = baselineInputs.map((a) => {
      const extraDays = extraDaysByActivity.get(a.id);
      return extraDays ? { ...a, durationDays: Math.max(0, a.durationDays + extraDays) } : a;
    });
    const after = runCpm(whatIfInputs, dependencyInputs);

    const beforeProjectEnd = Math.max(...[...before.values()].map((r) => r.earlyFinish));
    const afterProjectEnd = Math.max(...[...after.values()].map((r) => r.earlyFinish));
    const projectEndDelayDays = afterProjectEnd - beforeProjectEnd;

    const affectedActivities = activityRows
      .map((activity) => {
        const b = before.get(activity.id)!;
        const a = after.get(activity.id)!;
        if (b.earlyFinish === a.earlyFinish && b.isCritical === a.isCritical) return null;
        return {
          id: activity.id,
          name: activity.name,
          isMilestone: activity.isMilestone,
          finishShiftDays: a.earlyFinish - b.earlyFinish,
          becameCritical: !b.isCritical && a.isCritical,
          noLongerCritical: b.isCritical && !a.isCritical,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const affectedMilestones = affectedActivities.filter((a) => a.isMilestone);

    return {
      scheduleId,
      projectEndDelayDays,
      criticalPathImpacted: projectEndDelayDays !== 0,
      affectedActivities,
      affectedMilestones,
    };
  }

  private async explainImpact(
    tenantId: string,
    actorId: string,
    delayedActivityName: string,
    delayDays: number,
    projectEndDelayDays: number,
    affectedActivities: Array<{ name: string; finishShiftDays: number; becameCritical: boolean }>,
  ): Promise<{ options: string[]; aiRunId: string | null; confidence: number }> {
    try {
      const toolSpec: AiToolSpec = {
        name: TOOL_NAME,
        description: "Report mitigation options for this schedule delay.",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod-to-json-schema's ZodSchema type is a distinct nominal type from this codebase's "zod" import; see photo-ai.service.ts's identical bridge comment.
        inputSchema: zodToJsonSchema(emitOptionsInputSchema as any, { target: "jsonSchema7", $refStrategy: "none" }) as Record<
          string,
          unknown
        >,
      };

      const facts = [
        `Delayed activity: "${delayedActivityName}", ${delayDays} day(s).`,
        `Project-end shift: ${projectEndDelayDays} day(s).`,
        affectedActivities.length > 0
          ? `Affected downstream activities:\n${affectedActivities
              .map((a) => `- ${a.name}: finish shifts ${a.finishShiftDays} day(s)${a.becameCritical ? ", becomes critical" : ""}`)
              .join("\n")}`
          : "No downstream activities are affected (the delay is fully absorbed by float).",
      ].join("\n\n");

      const result = await this.aiGateway.run(tenantId, actorId, {
        purpose: "scheduling.ai_delay_impact",
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: facts,
        tools: [toolSpec],
        forceToolName: TOOL_NAME,
        maxTokens: MAX_TOKENS,
      });

      const call = result.toolCalls[0];
      if (!call) throw new Error(`Scheduling AI: model did not call ${TOOL_NAME}`);
      const parsed = emitOptionsInputSchema.parse(call.input);

      return { options: parsed.options, aiRunId: result.aiRunId, confidence: 0.9 };
    } catch {
      // The CPM impact above is exact regardless — a failed/unconfigured
      // model call only degrades the qualitative options to a generic,
      // always-applicable set, reflected in the lower confidence.
      return { options: FALLBACK_OPTIONS, aiRunId: null, confidence: 0.4 };
    }
  }
}
