import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import {
  createNatsConnection,
  ensureEventStream,
  NATS_CONNECTION,
} from "../../infrastructure/nats/client";
import { DashboardsController } from "./api/dashboards.controller";
import { DashboardProjectionsWriterService } from "./application/dashboard-projections-writer.service";
import { DashboardsService } from "./application/dashboards.service";
import { DashboardProjectionsConsumerWorker } from "./infrastructure/dashboard-projections-consumer.worker";

const env = loadEnv();

@Module({
  controllers: [DashboardsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    {
      provide: NATS_CONNECTION,
      useFactory: async () => {
        const nc = await createNatsConnection(env);
        await ensureEventStream(nc);
        return nc;
      },
    },
    DashboardsService,
    DashboardProjectionsWriterService,
    DashboardProjectionsConsumerWorker,
  ],
})
export class DashboardsModule {}
