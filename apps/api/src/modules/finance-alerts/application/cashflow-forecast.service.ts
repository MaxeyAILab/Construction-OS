import { Inject, Injectable } from "@nestjs/common";
import type { CashflowForecastResult, CashflowForecastWeek } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { invoices } from "../../../infrastructure/db/schema";
import { AiGatewayService } from "../../ai";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 300;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// No dueDate is set on pay-app-generated receivable invoices (only
// issueDate) — net-30 is a documented, explicit fallback assumption for
// bucketing those, not a fabricated prediction.
const DEFAULT_NET_TERMS_DAYS = 30;

const SYSTEM_PROMPT =
  "You are a construction company controller. Given a week-by-week cash-flow projection (projected inflows from client invoices, outflows to suppliers/subs, and a running cumulative balance), write a concise 2-3 sentence summary calling out any week where the cumulative balance goes negative or drops sharply, and whether inflows or outflows dominate the horizon. Reason only from the numbers given.";

interface OpenInvoice {
  direction: "payable" | "receivable";
  balance: number;
  expectedDate: Date;
}

function toMoney(n: number): string {
  return n.toFixed(2);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ai-spec.md §7.10 (Financial AI, M9) / FR-FIN-7. api.md §10: "POST
// /finance/ai/cashflow-forecast -> {horizon_weeks} -> projected
// inflows/outflows + confidence bands." Company-wide across all the
// caller's projects (api.md doesn't scope this to a project id, same
// company-wide shape as GET /finance/alerts).
//
// "Rule computes fact, AI narrates" — same hybrid as MarginErosionService/
// ProcurementNeedsService/DelayImpactService/DrawingDiffService: the
// week-by-week bucketing of every open (status='approved', balance > 0)
// invoice's expected settlement date is exact arithmetic over real
// invoice data, never a trained forecasting model (this codebase has no
// ML training infra, and the roadmap row's own "cost-ledger history
// depth (>= 2 quarters)" dependency + explicit High risk rating signal
// that a calibrated model is a later, data-driven iteration, not this
// pass). Confidence bands widen linearly with weeks out — a documented,
// literal reading of ai-spec §8's "interval width" confidence signal,
// not a statistically fitted variance. CTC forecasting (already served
// by FinancialSummaryService) and invoice anomaly detection (already
// served by GET /finance/alerts) are the Financial AI capabilities this
// pass doesn't duplicate — cash-flow projection is the one net-new
// api.md endpoint for this roadmap row.
@Injectable()
export class CashflowForecastService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async forecast(tenantId: string, actorId: string, horizonWeeks: number): Promise<CashflowForecastResult> {
    const now = new Date();
    const openInvoices = await this.loadOpenInvoices(tenantId, now);

    const weeks: CashflowForecastWeek[] = [];
    let cumulative = 0;
    for (let w = 0; w < horizonWeeks; w++) {
      const weekStart = addDays(now, w * 7);
      const weekEnd = addDays(now, (w + 1) * 7 - 1);

      let inflow = 0;
      let outflow = 0;
      for (const inv of openInvoices) {
        if (inv.expectedDate < weekStart || inv.expectedDate > weekEnd) continue;
        if (inv.direction === "receivable") inflow += inv.balance;
        else outflow += inv.balance;
      }

      const net = inflow - outflow;
      cumulative += net;
      // Widens 5 percentage points per week out, capped at 50% —
      // documented heuristic, see class doc comment.
      const bandPct = Math.min(0.5, 0.05 * (w + 1));
      const bandAmount = Math.abs(cumulative) * bandPct;

      weeks.push({
        weekStart: isoDate(weekStart),
        weekEnd: isoDate(weekEnd),
        projectedInflow: toMoney(inflow),
        projectedOutflow: toMoney(outflow),
        netCashFlow: toMoney(net),
        cumulativeCashFlow: toMoney(cumulative),
        lowerBound: toMoney(cumulative - bandAmount),
        upperBound: toMoney(cumulative + bandAmount),
        confidence: Number((1 - bandPct).toFixed(2)),
      });
    }

    const { summary, aiRunId } = await this.summarize(tenantId, actorId, weeks);

    return { horizonWeeks, generatedAt: now.toISOString(), weeks, summary, aiRunId };
  }

  private async loadOpenInvoices(tenantId: string, now: Date): Promise<OpenInvoice[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.query.invoices.findMany({
        where: and(eq(invoices.tenantId, tenantId), eq(invoices.status, "approved")),
      });

      const open: OpenInvoice[] = [];
      for (const row of rows) {
        const balance = Number(row.totalAmount) - Number(row.paidAmount);
        if (balance <= 0) continue;
        const rawExpectedDate = row.dueDate
          ? new Date(row.dueDate)
          : addDays(new Date(row.issueDate), DEFAULT_NET_TERMS_DAYS);
        // Already-overdue amounts are still money owed/owing — clamp into
        // week 0 (the nearest bucket) rather than silently dropping them
        // for falling before the horizon's start.
        const expectedDate = rawExpectedDate < now ? now : rawExpectedDate;
        open.push({ direction: row.direction as "payable" | "receivable", balance, expectedDate });
      }
      return open;
    });
  }

  private async summarize(
    tenantId: string,
    actorId: string,
    weeks: CashflowForecastWeek[],
  ): Promise<{ summary: string | null; aiRunId: string | null }> {
    try {
      const facts = weeks
        .map(
          (w) =>
            `${w.weekStart} to ${w.weekEnd}: inflow ${w.projectedInflow}, outflow ${w.projectedOutflow}, cumulative ${w.cumulativeCashFlow} (confidence ${w.confidence})`,
        )
        .join("\n");

      const result = await this.aiGateway.run(tenantId, actorId, {
        purpose: "finance.cashflow_forecast_summary",
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: facts,
        maxTokens: MAX_TOKENS,
      });

      return { summary: result.content?.trim() ?? null, aiRunId: result.aiRunId };
    } catch {
      // The week-by-week projection above is exact and already returned —
      // a failed/unconfigured model call only loses the narrative summary,
      // same tolerance as every other best-effort AI enrichment this
      // session.
      return { summary: null, aiRunId: null };
    }
  }
}
