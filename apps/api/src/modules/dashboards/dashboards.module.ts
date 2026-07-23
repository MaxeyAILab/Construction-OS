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
  // M17 Project Assistant (ai-spec.md §7.2) reuses DashboardsService's
  // per-project rollup (status/health/margin/risk counts) as its
  // "get_project_summary" tool rather than re-deriving the same
  // projection-table + live-count aggregation — same "broaden an existing
  // module's public surface for a legitimate new cross-module need"
  // precedent as TasksModule/RfisModule exporting their own services.
  exports: [DashboardsService],
})
export class DashboardsModule {}
