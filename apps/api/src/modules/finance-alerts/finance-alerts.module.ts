import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createNatsConnection, ensureEventStream, NATS_CONNECTION } from "../../infrastructure/nats/client";
import { AiModule } from "../ai";
import { BudgetsModule } from "../budgets";
import { EventsModule } from "../events";
// ai-spec.md §7.10: InvoiceAnomalyService reuses InvoicesService.getById/
// listByCounterparty (read-only) — FinanceModule doesn't import
// FinanceAlertsModule anywhere ("nothing imports FinanceModule back", per
// its own doc comment), so this one-directional dependency is safe.
import { FinanceModule } from "../finance";
import { ProjectsModule } from "../projects";
import { CashflowForecastController } from "./api/cashflow-forecast.controller";
import { FinanceAlertsController } from "./api/finance-alerts.controller";
import { CashflowForecastService } from "./application/cashflow-forecast.service";
import { FinanceAlertsQueryService } from "./application/finance-alerts-query.service";
import { FinanceAlertsWriterService } from "./application/finance-alerts-writer.service";
import { InvoiceAnomalyService } from "./application/invoice-anomaly.service";
import { MarginErosionService } from "./application/margin-erosion.service";
import { FinanceAlertsConsumerWorker } from "./infrastructure/finance-alerts-consumer.worker";

const env = loadEnv();

@Module({
  imports: [AiModule, EventsModule, BudgetsModule, ProjectsModule, FinanceModule],
  controllers: [FinanceAlertsController, CashflowForecastController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    // Own NATS connection, same "each event-consumer module owns its own
    // connection, independent of every other module's" precedent as
    // RagModule/PhotoAiModule.
    {
      provide: NATS_CONNECTION,
      useFactory: async () => {
        const nc = await createNatsConnection(env);
        await ensureEventStream(nc);
        return nc;
      },
    },
    MarginErosionService,
    InvoiceAnomalyService,
    FinanceAlertsWriterService,
    FinanceAlertsConsumerWorker,
    FinanceAlertsQueryService,
    CashflowForecastService,
  ],
})
export class FinanceAlertsModule {}
