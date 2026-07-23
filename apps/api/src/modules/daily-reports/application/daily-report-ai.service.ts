import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { dailyReports } from "../../../infrastructure/db/schema";
import { AiGatewayService } from "../../ai";
import { OutboxService } from "../../events";
import { DailyReportsService } from "./daily-reports.service";
import { TimeEntriesService } from "./time-entries.service";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 512;

const SYSTEM_PROMPT =
  "You are a construction daily-report assistant. Write a concise 2-4 sentence narrative summarizing the day's logged field data (weather, labor hours, notes) in plain, professional field-log language. Only state what the data actually shows — never invent specifics (trades, quantities, incidents) that aren't present. If the underlying data is sparse, keep the summary brief and say so rather than padding it out.";

// api.md §9: `GET /daily-reports/{id}/ai-summary` — "Generated narrative
// (FR-FIELD-6) with edit-before-submit." Draft-only autonomy: this never
// writes daily_reports.narrative (the field actually submitted) — only the
// separate daily_reports.ai_summary display column, a dormant field that's
// existed in the schema since the Daily Reports row (0052) with nothing
// ever populating it. Every call regenerates fresh and re-meters (no
// caching to skip billing) — the same "AI endpoints always run live"
// convention as /crm/opportunities/{id}/ai-insights and
// /estimates/{id}/ai/suggest-lines, matching NFR-27's per-request rate
// limiting on AI endpoints.
@Injectable()
export class DailyReportAiService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
    private readonly outbox: OutboxService,
    private readonly dailyReportsService: DailyReportsService,
    private readonly timeEntriesService: TimeEntriesService,
  ) {}

  async generateSummary(tenantId: string, actorId: string, dailyReportId: string) {
    const report = await this.dailyReportsService.getById(tenantId, dailyReportId);

    const { data: entries } = await this.timeEntriesService.list(tenantId, { dailyReportId, limit: 100 });

    const facts: string[] = [];
    if (report.weather) facts.push(`Weather: ${JSON.stringify(report.weather)}`);
    if (report.narrative) facts.push(`Field notes: ${report.narrative}`);
    if (entries.length > 0) {
      const laborLines = entries.map(
        (e) => `${e.crewLabel ?? "a worker"}: ${e.hours} ${e.kind} hours`,
      );
      facts.push(`Logged labor:\n${laborLines.join("\n")}`);
    }

    const userPrompt =
      facts.length > 0
        ? `Report date: ${report.reportDate}\n\n${facts.join("\n\n")}`
        : `Report date: ${report.reportDate}\n\nNo weather, notes, or labor hours have been logged for this report yet.`;

    // Heuristic confidence, not a calibrated groundedness score — same
    // documented stand-in as Project Assistant's composeAnswer(): scales
    // with how many distinct fact categories actually back the summary.
    const groundingCount = facts.length;
    const confidence = groundingCount === 0 ? 0.3 : Math.min(0.95, 0.5 + 0.15 * groundingCount);

    const result = await this.aiGateway.run(tenantId, actorId, {
      purpose: "daily_report.ai_summary",
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: MAX_TOKENS,
    });

    const narrative = result.content?.trim() || "Not enough logged data yet to generate a meaningful summary.";

    await withTenant(this.db, tenantId, async (tx) => {
      await tx.update(dailyReports).set({ aiSummary: narrative, updatedBy: actorId }).where(eq(dailyReports.id, dailyReportId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "daily_report.ai_summary_generated.v1",
        dedupeKey: `daily_report.ai_summary_generated.v1:${dailyReportId}:${result.aiRunId}`,
        actorId,
        payload: { companyId: tenantId, projectId: report.projectId, dailyReportId, aiRunId: result.aiRunId },
      });
    });

    return { narrative, confidence, aiRunId: result.aiRunId };
  }
}
