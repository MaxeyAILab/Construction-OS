import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createNatsConnection, ensureEventStream, NATS_CONNECTION } from "../../infrastructure/nats/client";
import { AiModule } from "../ai";
import { BudgetsModule } from "../budgets";
import { EventsModule } from "../events";
import { EquipmentInsightsController } from "./api/equipment-insights.controller";
import { EquipmentController } from "./api/equipment.controller";
import { MaintenanceController } from "./api/maintenance.controller";
import { EquipmentAssignmentsService } from "./application/equipment-assignments.service";
import { EquipmentFaultAlertsWriterService } from "./application/equipment-fault-alerts-writer.service";
import { EquipmentFaultAlertsService } from "./application/equipment-fault-alerts.service";
import { EquipmentInsightsService } from "./application/equipment-insights.service";
import { EquipmentUsageLogsService } from "./application/equipment-usage-logs.service";
import { EquipmentService } from "./application/equipment.service";
import { MaintenanceService } from "./application/maintenance.service";
import { EquipmentFaultAlertsConsumerWorker } from "./infrastructure/equipment-fault-alerts-consumer.worker";

const env = loadEnv();

@Module({
  imports: [EventsModule, BudgetsModule, AiModule],
  controllers: [EquipmentController, MaintenanceController, EquipmentInsightsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    // Own NATS connection, same "each event-consumer module owns its own
    // connection, independent of every other module's" precedent as
    // FinanceAlertsModule/RagModule.
    {
      provide: NATS_CONNECTION,
      useFactory: async () => {
        const nc = await createNatsConnection(env);
        await ensureEventStream(nc);
        return nc;
      },
    },
    EquipmentService,
    EquipmentAssignmentsService,
    EquipmentUsageLogsService,
    MaintenanceService,
    EquipmentFaultAlertsService,
    EquipmentFaultAlertsWriterService,
    EquipmentFaultAlertsConsumerWorker,
    EquipmentInsightsService,
  ],
  exports: [EquipmentService, EquipmentAssignmentsService, EquipmentUsageLogsService, MaintenanceService, EquipmentInsightsService],
})
export class EquipmentModule {}
