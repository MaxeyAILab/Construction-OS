import { Inject, Injectable } from "@nestjs/common";
import type { ScheduleRiskItem, ScheduleRiskLevel, ScheduleRiskResponse } from "@constructionos/schemas";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { scheduleActivities, schedules } from "../../../infrastructure/db/schema";
import { SchedulesService } from "./schedules.service";

// A burn rate under this (float-days lost per calendar day) is noise —
// float naturally wobbles a little as a schedule progresses; flagging
// every activity with the tiniest negative drift would bury the real
// signal, same "the check is the authoritative rule, but needs a floor to
// mean anything" precedent as EstimatorAiService's
// MIN_PRICE_HISTORY_FOR_ANOMALY.
const MIN_BURN_RATE_PER_DAY = 0.05;
const HIGH_RISK_DAYS_UNTIL_CRITICAL = 14;
const MEDIUM_RISK_DAYS_UNTIL_CRITICAL = 30;

function diffDays(isoDateA: string, isoDateB: string): number {
  const a = new Date(`${isoDateA}T00:00:00Z`).getTime();
  const b = new Date(`${isoDateB}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}

function riskLevelFor(isCritical: boolean, daysUntilCritical: number): ScheduleRiskLevel | null {
  if (isCritical) return "critical";
  if (daysUntilCritical <= HIGH_RISK_DAYS_UNTIL_CRITICAL) return "high";
  if (daysUntilCritical <= MEDIUM_RISK_DAYS_UNTIL_CRITICAL) return "medium";
  return null;
}

// api.md §6 `GET /schedules/{id}/ai/risk` (FR-SCH-6, ai-spec.md §7.5
// "critical-path risk scoring (float burn-rate)") — a documented Scheduling
// AI capability with no endpoint of its own until now (see
// delay-impact.service.ts's doc comment on the other capabilities still
// missing one).
//
// Deterministic, same "the rule is the authoritative signal" split as
// DelayImpactService's CPM math: an activity's float is measured twice —
// once at its most recent baseline snapshot, once right now — and the
// difference divided by calendar days elapsed gives a burn rate (float-
// days lost per day). Projecting that rate forward against the activity's
// remaining float estimates how many days until it goes fully critical,
// even though it isn't yet — the "predictive" half roadmap.md's own
// success metric (slip-prediction AUC) is aimed at, versus
// DelayImpactService's reactive "a delay already happened, what does it
// do" simulation. No AI Gateway call: unlike delay-impact's mitigation
// options, ai-spec §7.5 doesn't ask this capability for a narrative, just
// a score.
@Injectable()
export class PredictiveScheduleRiskService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly schedules: SchedulesService,
  ) {}

  async computeRisk(tenantId: string, scheduleId: string): Promise<ScheduleRiskResponse> {
    return withTenant(this.db, tenantId, async (tx) => {
      const schedule = await this.schedules.requireSchedule(tx, scheduleId);

      const latestBaseline = await tx.query.schedules.findFirst({
        where: and(eq(schedules.baselineOfId, scheduleId), eq(schedules.kind, "baseline"), isNull(schedules.deletedAt)),
        orderBy: [desc(schedules.createdAt)],
      });
      if (!latestBaseline) return { scheduleId, baselineScheduleId: null, baselineDataDate: null, risks: [] };

      const today = new Date().toISOString().slice(0, 10);
      const baselineDate = latestBaseline.createdAt.toISOString().slice(0, 10);
      const daysSinceBaseline = diffDays(today, baselineDate);
      if (daysSinceBaseline <= 0) {
        return { scheduleId, baselineScheduleId: latestBaseline.id, baselineDataDate: baselineDate, risks: [] };
      }

      const [currentActivities, baselineActivities] = await Promise.all([
        tx.query.scheduleActivities.findMany({
          where: and(eq(scheduleActivities.scheduleId, scheduleId), isNull(scheduleActivities.deletedAt)),
        }),
        tx.query.scheduleActivities.findMany({
          where: and(eq(scheduleActivities.scheduleId, latestBaseline.id), isNull(scheduleActivities.deletedAt)),
        }),
      ]);
      const baselineBySourceId = new Map(baselineActivities.map((a) => [a.baselineSourceActivityId, a]));

      const risks: ScheduleRiskItem[] = [];
      for (const activity of currentActivities) {
        if (activity.actualEndDate) continue; // already finished — no forward risk left to project
        if (activity.totalFloatDays == null) continue; // recalculate() hasn't run yet

        const baselineActivity = baselineBySourceId.get(activity.id);
        if (!baselineActivity || baselineActivity.totalFloatDays == null) continue; // added after this baseline — nothing to compare

        const burnedFloatDays = baselineActivity.totalFloatDays - activity.totalFloatDays;
        const burnRatePerDay = burnedFloatDays / daysSinceBaseline;
        if (!activity.isCritical && burnRatePerDay < MIN_BURN_RATE_PER_DAY) continue;

        const daysUntilCritical = activity.isCritical
          ? 0
          : Math.max(0, Math.round(activity.totalFloatDays / burnRatePerDay));
        const riskLevel = riskLevelFor(activity.isCritical, daysUntilCritical);
        if (!riskLevel) continue;

        risks.push({
          activityId: activity.id,
          activityName: activity.name,
          isCritical: activity.isCritical,
          currentFloatDays: activity.totalFloatDays,
          baselineFloatDays: baselineActivity.totalFloatDays,
          burnedFloatDays,
          burnRatePerDay: Math.round(burnRatePerDay * 100) / 100,
          daysUntilCritical: activity.isCritical ? null : daysUntilCritical,
          riskLevel,
        });
      }

      risks.sort((a, b) => (a.daysUntilCritical ?? -1) - (b.daysUntilCritical ?? -1));

      return { scheduleId: schedule.id, baselineScheduleId: latestBaseline.id, baselineDataDate: baselineDate, risks };
    });
  }
}
