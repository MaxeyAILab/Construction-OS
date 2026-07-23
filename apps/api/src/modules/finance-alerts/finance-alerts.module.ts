import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createNatsConnection, ensureEventStream, NATS_CONNECTION } from "../../infrastructure/nats/client";
import { AiModule } from "../ai";
import { BudgetsModule } from "../budgets";
import { EventsModule } from "../events";
import { ProjectsModule } from "../projects";
import { FinanceAlertsController } from "./api/finance-alerts.controller";
import { FinanceAlertsQueryService } from "./application/finance-alerts-query.service";
import { FinanceAlertsWriterService } from "./application/finance-alerts-writer.service";
import { MarginErosionService } from "./application/margin-erosion.service";
import { FinanceAlertsConsumerWorker } from "./infrastructure/finance-alerts-consumer.worker";

const env = loadEnv();

@Module({
  imports: [AiModule, EventsModule, BudgetsModule, ProjectsModule],
  controllers: [FinanceAlertsController],
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
    FinanceAlertsWriterService,
    FinanceAlertsConsumerWorker,
    FinanceAlertsQueryService,
  ],
})
export class FinanceAlertsModule {}
