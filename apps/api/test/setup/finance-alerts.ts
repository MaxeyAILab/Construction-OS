import type { Database } from "../../src/infrastructure/db/client";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import { FinancialSummaryService } from "../../src/modules/budgets/application/financial-summary.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { FinanceAlertsQueryService } from "../../src/modules/finance-alerts/application/finance-alerts-query.service";
import { FinanceAlertsWriterService } from "../../src/modules/finance-alerts/application/finance-alerts-writer.service";
import { MarginErosionService } from "../../src/modules/finance-alerts/application/margin-erosion.service";
import type { ProjectsService } from "../../src/modules/projects/application/projects.service";
import { FakeAiProvider } from "./ai";

export function buildTestFinanceAlertsServices(db: Database, projectsService: ProjectsService) {
  const outbox = new OutboxService();
  const financialSummaryService = new FinancialSummaryService(db);
  const provider = new FakeAiProvider();
  const aiGatewayService = new AiGatewayService(db, provider);
  const marginErosionService = new MarginErosionService(db, financialSummaryService, projectsService, aiGatewayService, outbox);
  const financeAlertsWriterService = new FinanceAlertsWriterService(marginErosionService);
  const financeAlertsQueryService = new FinanceAlertsQueryService(db);
  return { marginErosionService, financeAlertsWriterService, financeAlertsQueryService, provider };
}
