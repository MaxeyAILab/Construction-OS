import { Inject, Injectable, Logger } from "@nestjs/common";
import { marginAlertSettingsSchema } from "@constructionos/schemas";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { financeAlerts } from "../../../infrastructure/db/schema";
import { AiGatewayService } from "../../ai";
import { FinancialSummaryService } from "../../budgets";
import { OutboxService } from "../../events";
import { ProjectsService } from "../../projects";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 300;
const KIND = "margin_erosion";

// FR-FIN-6 defaults — "sensible default, no provisioning required" per
// this codebase's own precedent (ai_budgets' DEFAULT_MONTHLY_LIMIT_USD):
// a project that never configures projects.settings.marginAlerts still
// gets alerted.
const DEFAULT_WARNING_THRESHOLD_PCT = 15;
const DEFAULT_CRITICAL_THRESHOLD_PCT = 5;

const SYSTEM_PROMPT =
  "You are a construction financial analyst. Given a project's current margin percentage, the threshold it just crossed, and cost variance broken down by category (labor, material, equipment, subcontract, other — negative means over budget), write a concise 2-3 sentence explanation of what's likely driving the margin erosion. Reason only from the numbers given — never invent a cause the data doesn't support.";

function labelKind(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

// ai-spec.md §7.10 (Financial AI): "margin-erosion early warning with
// causal decomposition." Rule+AI hybrid per roadmap.md — the THRESHOLD
// CHECK is the deterministic, authoritative rule (FR-FIN-6: "alert when
// margin erodes past configurable thresholds"); the AI causal-
// decomposition explanation is a best-effort enrichment layered on top,
// never a precondition for the alert firing. If the AI call fails (budget
// exhausted, provider error), the alert still persists with
// explanation=null — a financial alert must never silently fail to fire
// because a model call did.
@Injectable()
export class MarginErosionService {
  private readonly logger = new Logger(MarginErosionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly financialSummary: FinancialSummaryService,
    private readonly projectsService: ProjectsService,
    private readonly aiGateway: AiGatewayService,
    private readonly outbox: OutboxService,
  ) {}

  async checkProject(tenantId: string, projectId: string): Promise<void> {
    const summary = await this.financialSummary.get(tenantId, projectId);
    if (summary.marginPct === null) return; // no contract value set — nothing to alert on

    const project = await this.projectsService.get(tenantId, projectId);
    const parsedSettings = marginAlertSettingsSchema.safeParse(
      (project.settings as { marginAlerts?: unknown } | null)?.marginAlerts,
    );
    const warningThresholdPct = parsedSettings.data?.warningThresholdPct ?? DEFAULT_WARNING_THRESHOLD_PCT;
    const criticalThresholdPct = parsedSettings.data?.criticalThresholdPct ?? DEFAULT_CRITICAL_THRESHOLD_PCT;

    let severity: "warning" | "critical" | null = null;
    let thresholdPct = warningThresholdPct;
    if (summary.marginPct < criticalThresholdPct) {
      severity = "critical";
      thresholdPct = criticalThresholdPct;
    } else if (summary.marginPct < warningThresholdPct) {
      severity = "warning";
      thresholdPct = warningThresholdPct;
    }
    if (!severity) return; // margin healthy — no alert

    const latest = await withTenant(this.db, tenantId, (tx) =>
      tx.query.financeAlerts.findFirst({
        where: and(eq(financeAlerts.tenantId, tenantId), eq(financeAlerts.projectId, projectId), eq(financeAlerts.kind, KIND)),
        orderBy: [desc(financeAlerts.createdAt)],
      }),
    );
    // Dedup: only re-fire when severity has actually changed since the
    // last alert (v1 simplification — no recovery/re-breach detection
    // within the same severity band; flagged as a real follow-up, not
    // silently dropped, same as Photo AI's progress-inference deferral).
    if (latest?.severity === severity) return;

    const explanation = await this.explainErosion(tenantId, projectId, summary.marginPct, thresholdPct);

    await withTenant(this.db, tenantId, async (tx) => {
      const [alert] = await tx
        .insert(financeAlerts)
        .values({
          tenantId,
          projectId,
          kind: KIND,
          severity,
          marginPct: summary.marginPct!.toFixed(2),
          thresholdPct: thresholdPct.toFixed(2),
          explanation: explanation?.text ?? null,
          aiRunId: explanation?.aiRunId ?? null,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "finance_alert.created.v1",
        dedupeKey: `finance_alert.created.v1:${alert!.id}`,
        actorId: null,
        actorType: "system",
        payload: {
          companyId: tenantId,
          projectId,
          financeAlertId: alert!.id,
          severity,
          aiRunId: explanation?.aiRunId ?? null,
        },
      });
    });
  }

  private async explainErosion(
    tenantId: string,
    projectId: string,
    marginPct: number,
    thresholdPct: number,
  ): Promise<{ text: string; aiRunId: string } | null> {
    try {
      const breakdown = await this.financialSummary.getCategoryVariance(tenantId, projectId);
      const facts =
        breakdown.length > 0
          ? breakdown.map((b) => `${labelKind(b.kind)}: ${b.variance} (${Number(b.variance) < 0 ? "over budget" : "under budget"})`)
          : ["No cost-code-level variance breakdown is available for this project."];

      const result = await this.aiGateway.run(tenantId, null, {
        purpose: "finance.margin_erosion_explanation",
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `Current margin: ${marginPct}%. Threshold crossed: ${thresholdPct}%.\n\nCost variance by category:\n${facts.join("\n")}`,
        maxTokens: MAX_TOKENS,
      });

      if (!result.content) return null;
      return { text: result.content.trim(), aiRunId: result.aiRunId };
    } catch (err) {
      this.logger.warn(`margin-erosion causal explanation failed for project ${projectId}, alert still fires without it: ${err}`);
      return null;
    }
  }
}
