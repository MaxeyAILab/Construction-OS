import { Inject, Injectable } from "@nestjs/common";
import type { ExecutiveBriefing, ExecutiveBriefingAnomaly } from "@constructionos/schemas";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AiGatewayService } from "../../ai";
import { OpportunitiesService } from "../../crm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { companyBriefings } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CashflowForecastService, FinanceAlertsQueryService } from "../../finance-alerts";
import { PredictiveScheduleRiskService } from "../../scheduling/application/predictive-schedule-risk.service";
import { SchedulesService } from "../../scheduling/application/schedules.service";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 300;
// How many finance alerts to fold into the aggregate count. finance_alerts
// has no resolution/status column (append-only, same as compliance_alerts)
// — there's no "open" state to filter on, so this is a straight recent-N
// count, not a true "currently unresolved" count.
const FINANCE_ALERT_SCAN_LIMIT = 200;
const CASHFLOW_HORIZON_WEEKS = 4;
const TOP_ANOMALIES_PER_KIND = 3;
const DEFAULT_PROBABILITY_PCT = 50;

function toMoney(n: number): string {
  return n.toFixed(2);
}

// api.md §14 `POST /dashboards/company/briefing` / `GET
// /dashboards/company/briefings` (FR-EXEC-3 "the system shall provide
// proactive alerts on company-wide risks and anomalies"; ai-spec.md §7.1
// Executive Assistant: "weekly proactive briefing (notification + portal
// card)", "anomaly surfacing (margin erosion, AR aging spikes, pipeline
// stalls)"). Same "rule computes fact, AI narrates" split as every other AI
// feature this session: the aggregate numbers are exact reads/sums over
// already-built primitives (FinanceAlertsQueryService, the CPM-backed
// PredictiveScheduleRiskService looped over every active project,
// OpportunitiesService's weighted pipeline, CashflowForecastService) — the
// AI Gateway call only turns those numbers into the short executive
// narrative ai-spec §7.1 asks for, best-effort like every other narrative
// this session (a failed/unconfigured model call degrades the narrative to
// null, never the briefing itself).
//
// Deliberately narrower than ai-spec §7.1's full capability list: NL Q&A
// over whole-company data and board-pack drafting have no endpoint of
// their own this pass (only the proactive-briefing half is built) — a
// flagged follow-up, not silently built here, same precedent as
// DelayImpactService's own doc comment about Scheduling AI's fuller list.
// "AR aging spikes" specifically isn't computed either: there is no
// AR-aging/invoice-due-date rollup in this codebase distinct from
// CashflowForecastService's own receivable bucketing, which this briefing
// already reuses.
@Injectable()
export class ExecutiveBriefingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly opportunities: OpportunitiesService,
    private readonly financeAlerts: FinanceAlertsQueryService,
    private readonly scheduleRisk: PredictiveScheduleRiskService,
    private readonly schedules: SchedulesService,
    private readonly cashflowForecast: CashflowForecastService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async generate(
    tenantId: string,
    actorId: string,
    notifyUserId: string | null,
    actorType?: "user" | "ai",
  ): Promise<ExecutiveBriefing> {
    const [financeAlertsPage, scheduleRiskItems, pipelineWeightedValue, cashflow] = await Promise.all([
      this.financeAlerts.list(tenantId, { limit: FINANCE_ALERT_SCAN_LIMIT }),
      this.computeScheduleRiskAcrossActiveProjects(tenantId),
      this.computePipelineWeightedValue(tenantId),
      this.cashflowForecast.forecast(tenantId, actorId, CASHFLOW_HORIZON_WEEKS),
    ]);

    const netCashFlowNext4Weeks = cashflow.weeks.reduce((sum, w) => sum + Number(w.netCashFlow), 0);
    const criticalRisks = scheduleRiskItems.filter((r) => r.riskLevel === "critical");
    const highRisks = scheduleRiskItems.filter((r) => r.riskLevel === "high");

    const topAnomalies: ExecutiveBriefingAnomaly[] = [
      ...financeAlertsPage.data.slice(0, TOP_ANOMALIES_PER_KIND).map(
        (a): ExecutiveBriefingAnomaly => ({
          kind: a.kind,
          entityType: "finance_alert",
          entityId: a.id,
          label:
            a.kind === "margin_erosion"
              ? `Margin erosion: ${a.marginPct}% (threshold ${a.thresholdPct}%)`
              : `Duplicate invoice suspected`,
        }),
      ),
      ...criticalRisks.slice(0, TOP_ANOMALIES_PER_KIND).map(
        (r): ExecutiveBriefingAnomaly => ({
          kind: "schedule_risk_critical",
          entityType: "schedule_activity",
          entityId: r.activityId,
          label: `"${r.activityName}" is on the critical path`,
        }),
      ),
      ...highRisks.slice(0, TOP_ANOMALIES_PER_KIND).map(
        (r): ExecutiveBriefingAnomaly => ({
          kind: "schedule_risk_high",
          entityType: "schedule_activity",
          entityId: r.activityId,
          label: `"${r.activityName}" projected critical in ${r.daysUntilCritical}d`,
        }),
      ),
    ];

    const summary = {
      pipelineWeightedValueAmount: toMoney(pipelineWeightedValue),
      openFinanceAlertCount: financeAlertsPage.data.length,
      criticalScheduleRiskCount: criticalRisks.length,
      highScheduleRiskCount: highRisks.length,
      netCashFlowNext4WeeksAmount: toMoney(netCashFlowNext4Weeks),
      topAnomalies,
    };

    const { narrative, aiRunId } = await this.narrate(tenantId, actorId, summary);

    const created = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(companyBriefings)
        .values({ tenantId, summary, narrative, aiRunId, createdBy: actorId })
        .returning();
      return row!;
    });

    await withTenant(this.db, tenantId, (tx) =>
      this.outbox.append(tx, {
        tenantId,
        eventType: "company_briefing.generated.v1",
        ...(actorType ? { actorType } : {}),
        dedupeKey: `company_briefing.generated.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, companyBriefingId: created.id, notifyUserId, aiRunId },
      }),
    );

    return this.toDto(created);
  }

  async list(tenantId: string, limit: number): Promise<ExecutiveBriefing[]> {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx.query.companyBriefings.findMany({
        where: and(eq(companyBriefings.tenantId, tenantId), isNull(companyBriefings.deletedAt)),
        orderBy: [desc(companyBriefings.createdAt)],
        limit,
      }),
    );
    return rows.map((r) => this.toDto(r));
  }

  private async computeScheduleRiskAcrossActiveProjects(tenantId: string) {
    const activeSchedules = await this.schedules.listActiveMasterScheduleIds(tenantId);
    const results = await Promise.all(activeSchedules.map(({ scheduleId }) => this.scheduleRisk.computeRisk(tenantId, scheduleId)));
    return results.flatMap((r) => r.risks);
  }

  private async computePipelineWeightedValue(tenantId: string): Promise<number> {
    const openOpportunities = await this.opportunities.listOpenForPipeline(tenantId);
    return openOpportunities.reduce((sum, o) => {
      const pct = o.probability ?? o.defaultProbabilityPct ?? String(DEFAULT_PROBABILITY_PCT);
      return sum + Number(o.expectedValueAmount) * (Number(pct) / 100);
    }, 0);
  }

  private async narrate(
    tenantId: string,
    actorId: string,
    summary: ExecutiveBriefing["summary"],
  ): Promise<{ narrative: string | null; aiRunId: string | null }> {
    try {
      const facts = [
        `Weighted pipeline value: ${summary.pipelineWeightedValueAmount}.`,
        `Open finance alerts (margin erosion / duplicate invoices): ${summary.openFinanceAlertCount}.`,
        `Schedule risk: ${summary.criticalScheduleRiskCount} activity(ies) already critical, ${summary.highScheduleRiskCount} projected critical soon.`,
        `Net cash flow, next ${CASHFLOW_HORIZON_WEEKS} weeks: ${summary.netCashFlowNext4WeeksAmount}.`,
        summary.topAnomalies.length > 0
          ? `Top items:\n${summary.topAnomalies.map((a) => `- ${a.label}`).join("\n")}`
          : "No individual anomalies to call out this week.",
      ].join("\n");

      const result = await this.aiGateway.run(tenantId, actorId, {
        purpose: "dashboards.ai_executive_briefing",
        model: MODEL,
        systemPrompt:
          "You are a construction company's executive assistant writing a short weekly briefing. Given the company's pipeline value, open finance alerts, schedule risk counts, and near-term cash flow, write a 3-4 sentence executive summary calling out what most needs attention this week. Reason only from the numbers given.",
        userPrompt: facts,
        maxTokens: MAX_TOKENS,
      });

      return { narrative: result.content?.trim() ?? null, aiRunId: result.aiRunId };
    } catch {
      // The aggregate numbers above are exact and already computed — a
      // failed/unconfigured model call only loses the narrative summary,
      // same tolerance as every other best-effort AI enrichment this
      // session.
      return { narrative: null, aiRunId: null };
    }
  }

  private toDto(row: typeof companyBriefings.$inferSelect): ExecutiveBriefing {
    return {
      id: row.id,
      generatedAt: row.createdAt.toISOString(),
      summary: row.summary as ExecutiveBriefing["summary"],
      narrative: row.narrative,
      aiRunId: row.aiRunId,
    };
  }
}
