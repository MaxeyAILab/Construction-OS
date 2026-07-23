import type { Database } from "../../src/infrastructure/db/client";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import { DailyReportAiService } from "../../src/modules/daily-reports/application/daily-report-ai.service";
import type { DailyReportsService } from "../../src/modules/daily-reports/application/daily-reports.service";
import type { TimeEntriesService } from "../../src/modules/daily-reports/application/time-entries.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { FakeAiProvider } from "./ai";

export function buildTestDailyReportAiServices(
  db: Database,
  dailyReportsService: DailyReportsService,
  timeEntriesService: TimeEntriesService,
): { dailyReportAiService: DailyReportAiService; provider: FakeAiProvider } {
  const provider = new FakeAiProvider();
  const aiGatewayService = new AiGatewayService(db, provider);
  const outbox = new OutboxService();
  const dailyReportAiService = new DailyReportAiService(db, aiGatewayService, outbox, dailyReportsService, timeEntriesService);
  return { dailyReportAiService, provider };
}
