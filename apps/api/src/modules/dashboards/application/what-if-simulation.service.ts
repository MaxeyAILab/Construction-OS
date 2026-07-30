import { Injectable } from "@nestjs/common";
import type { SimulateWhatIfInput, WhatIfSimulationResult } from "@constructionos/schemas";
import { AiGatewayService } from "../../ai";
import { OpportunitiesService } from "../../crm";
import { DelayImpactService } from "../../scheduling/application/delay-impact.service";
import { ResourceAssignmentsService } from "../../scheduling/application/resource-assignments.service";
import { OpportunityNotOpenError, WhatIfResourceAssignmentNotFoundError, WhatIfScheduleMismatchError } from "../domain/errors";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 300;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Documented fallback, same "explicit assumption over a fabricated
// prediction" precedent as CashflowForecastService's DEFAULT_NET_TERMS_DAYS
// — only used when an opportunity has neither its own probability nor a
// stage-level default set.
const DEFAULT_PROBABILITY_PCT = 50;

function toMoney(n: number): string {
  return n.toFixed(2);
}

interface PipelineOpportunity {
  id: string;
  expectedValueAmount: string;
  probability: string | null;
  defaultProbabilityPct: string | null;
}

function weightedValueOf(o: PipelineOpportunity): number {
  const pct = o.probability ?? o.defaultProbabilityPct ?? String(DEFAULT_PROBABILITY_PCT);
  return Number(o.expectedValueAmount) * (Number(pct) / 100);
}

// api.md §14 `POST /dashboards/company/what-if` (FR-EXEC-4, ai-spec.md §7.1
// "what-if sketches": "what does losing the Harbor bid do to Q4 revenue")
// and roadmap.md's dedicated Phase 3 row "What-if simulation (bid loss,
// crew moves, delay cascades)". Same "rule computes fact, AI narrates"
// split as every other AI feature this session: each scenario's numeric
// outcome is deterministic arithmetic/CPM re-runs composed from the
// existing Financial/Scheduling primitives (OpportunitiesService's
// pipeline, DelayImpactService.simulateCascade's CPM engine,
// ResourceAssignmentsService's overlap check) — the AI Gateway call only
// turns those numbers into the short executive sketch ai-spec §7.1 asks
// for, and is best-effort (a failed/unconfigured model call degrades to a
// null narrative, never to an empty simulation). Nothing is written back —
// a pure simulation, same as DelayImpactService/PredictiveScheduleRiskService.
@Injectable()
export class WhatIfSimulationService {
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly resourceAssignments: ResourceAssignmentsService,
    private readonly delayImpact: DelayImpactService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async simulate(tenantId: string, actorId: string, input: SimulateWhatIfInput): Promise<WhatIfSimulationResult> {
    switch (input.type) {
      case "bid_loss":
        return this.simulateBidLoss(tenantId, actorId, input.opportunityId);
      case "crew_move":
        return this.simulateCrewMove(
          tenantId,
          actorId,
          input.scheduleId,
          input.resourceAssignmentIds,
          input.targetActivityId ?? null,
        );
      case "delay_cascade":
        return this.simulateDelayCascade(tenantId, actorId, input.scheduleId, input.delays);
    }
  }

  private async simulateBidLoss(tenantId: string, actorId: string, opportunityId: string): Promise<WhatIfSimulationResult> {
    const target = await this.opportunities.getById(tenantId, opportunityId);
    if (target.status !== "open") throw new OpportunityNotOpenError();

    const openOpportunities = await this.opportunities.listOpenForPipeline(tenantId);
    const before = openOpportunities.reduce((sum, o) => sum + weightedValueOf(o), 0);
    const lost = openOpportunities.find((o) => o.id === opportunityId);
    const lostWeightedValue = lost ? weightedValueOf(lost) : 0;
    const after = before - lostWeightedValue;
    const deltaPct = before !== 0 ? Number((((after - before) / before) * 100).toFixed(1)) : 0;

    const { narrative, aiRunId } = await this.narrate(
      tenantId,
      actorId,
      "dashboards.ai_what_if_bid_loss",
      "You are a construction company controller briefing an executive. Given a lost bid's expected value and its effect on the weighted sales pipeline, write a 2-3 sentence sketch of the impact — plain language, no hedging beyond what the numbers show.",
      [
        `Lost opportunity: "${target.name}", expected value ${toMoney(Number(target.expectedValueAmount))}.`,
        `Weighted pipeline before: ${toMoney(before)}. After: ${toMoney(after)} (${deltaPct}%).`,
      ].join("\n"),
    );

    return {
      type: "bid_loss",
      opportunityId,
      opportunityName: target.name,
      lostWeightedValueAmount: toMoney(lostWeightedValue),
      pipelineWeightedValueBefore: toMoney(before),
      pipelineWeightedValueAfter: toMoney(after),
      pipelineWeightedValueDeltaPct: deltaPct,
      narrative,
      aiRunId,
    };
  }

  private async simulateCrewMove(
    tenantId: string,
    actorId: string,
    scheduleId: string,
    resourceAssignmentIds: string[],
    targetActivityId: string | null,
  ): Promise<WhatIfSimulationResult> {
    const rows = await this.resourceAssignments.listByIdsWithActivity(tenantId, resourceAssignmentIds);
    if (rows.length !== resourceAssignmentIds.length) throw new WhatIfResourceAssignmentNotFoundError();
    if (rows.some((r) => r.activityScheduleId !== scheduleId)) throw new WhatIfScheduleMismatchError();

    // Losing a resource for its full assigned window is modeled as an
    // equivalent activity delay (the same lever DelayImpactService's CPM
    // re-run understands) — a documented approximation, not a labor-
    // productivity model this schema has no data to support. Where several
    // removed assignments hit the same activity, the max (not the sum) is
    // used: overlapping crew losses cost the activity once, not per crew.
    const lostDaysByActivity = new Map<string, number>();
    const movedAssignments = rows.map((r) => {
      const lostDays = Math.max(1, Math.ceil((r.assignment.endAt.getTime() - r.assignment.startAt.getTime()) / MS_PER_DAY));
      lostDaysByActivity.set(r.activityId, Math.max(lostDaysByActivity.get(r.activityId) ?? 0, lostDays));
      return {
        resourceAssignmentId: r.assignment.id,
        fromActivityId: r.activityId,
        fromActivityName: r.activityName,
        lostDays,
      };
    });

    const newConflicts: { resourceAssignmentId: string; conflictingAssignmentId: string }[] = [];
    if (targetActivityId) {
      for (const r of rows) {
        const label =
          r.assignment.resourceType === "equipment" ? r.assignment.equipmentId! : r.assignment.crewLabel!;
        const overlaps = await this.resourceAssignments.findOverlapping(
          tenantId,
          targetActivityId,
          r.assignment.resourceType as "crew" | "equipment",
          label,
          r.assignment.startAt,
          r.assignment.endAt,
        );
        for (const overlap of overlaps) {
          newConflicts.push({ resourceAssignmentId: r.assignment.id, conflictingAssignmentId: overlap.id });
        }
      }
    }

    const delays = [...lostDaysByActivity.entries()].map(([activityId, days]) => ({ activityId, days }));
    const cascade = await this.delayImpact.simulateCascade(tenantId, scheduleId, delays);

    const { narrative, aiRunId } = await this.narrate(
      tenantId,
      actorId,
      "dashboards.ai_what_if_crew_move",
      "You are a construction project executive assistant. Given a crew/equipment reassignment's effect on project-end date and any new resource conflicts, write a 2-3 sentence executive summary.",
      [
        `Moving ${movedAssignments.length} resource assignment(s)${targetActivityId ? " to a new activity" : " off their current activities"}.`,
        `Project-end shift: ${cascade.projectEndDelayDays} day(s).`,
        newConflicts.length > 0
          ? `${newConflicts.length} new resource conflict(s) at the target activity.`
          : "No new resource conflicts.",
      ].join("\n"),
    );

    return {
      type: "crew_move",
      scheduleId,
      movedAssignments,
      targetActivityId,
      newConflicts,
      projectEndDelayDays: cascade.projectEndDelayDays,
      criticalPathImpacted: cascade.criticalPathImpacted,
      affectedActivities: cascade.affectedActivities,
      narrative,
      aiRunId,
    };
  }

  private async simulateDelayCascade(
    tenantId: string,
    actorId: string,
    scheduleId: string,
    delays: Array<{ activityId: string; days: number }>,
  ): Promise<WhatIfSimulationResult> {
    const cascade = await this.delayImpact.simulateCascade(tenantId, scheduleId, delays);

    const { narrative, aiRunId } = await this.narrate(
      tenantId,
      actorId,
      "dashboards.ai_what_if_delay_cascade",
      "You are a construction project executive assistant. Given multiple simultaneous activity delays and their combined effect on project-end date and milestones, write a 2-3 sentence executive summary.",
      [
        `${delays.length} activity delay(s) simulated simultaneously.`,
        `Project-end shift: ${cascade.projectEndDelayDays} day(s).`,
        cascade.affectedMilestones.length > 0
          ? `Affected milestones: ${cascade.affectedMilestones.map((m) => `${m.name} (+${m.finishShiftDays}d)`).join(", ")}.`
          : "No milestones affected.",
      ].join("\n"),
    );

    return {
      type: "delay_cascade",
      scheduleId,
      projectEndDelayDays: cascade.projectEndDelayDays,
      criticalPathImpacted: cascade.criticalPathImpacted,
      affectedActivities: cascade.affectedActivities,
      affectedMilestones: cascade.affectedMilestones,
      narrative,
      aiRunId,
    };
  }

  private async narrate(
    tenantId: string,
    actorId: string,
    purpose: string,
    systemPrompt: string,
    facts: string,
  ): Promise<{ narrative: string | null; aiRunId: string | null }> {
    try {
      const result = await this.aiGateway.run(tenantId, actorId, {
        purpose,
        model: MODEL,
        systemPrompt,
        userPrompt: facts,
        maxTokens: MAX_TOKENS,
      });
      return { narrative: result.content?.trim() ?? null, aiRunId: result.aiRunId };
    } catch {
      // The simulation numbers above are exact and already returned — a
      // failed/unconfigured model call only loses the narrative sketch,
      // same tolerance as every other best-effort AI enrichment this
      // session.
      return { narrative: null, aiRunId: null };
    }
  }
}
