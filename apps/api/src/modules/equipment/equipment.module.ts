import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { BudgetsModule } from "../budgets";
import { EventsModule } from "../events";
import { EquipmentInsightsController } from "./api/equipment-insights.controller";
import { EquipmentController } from "./api/equipment.controller";
import { MaintenanceController } from "./api/maintenance.controller";
import { EquipmentAssignmentsService } from "./application/equipment-assignments.service";
import { EquipmentInsightsService } from "./application/equipment-insights.service";
import { EquipmentUsageLogsService } from "./application/equipment-usage-logs.service";
import { EquipmentService } from "./application/equipment.service";
import { MaintenanceService } from "./application/maintenance.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, BudgetsModule],
  controllers: [EquipmentController, MaintenanceController, EquipmentInsightsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    EquipmentService,
    EquipmentAssignmentsService,
    EquipmentUsageLogsService,
    MaintenanceService,
    EquipmentInsightsService,
  ],
  exports: [EquipmentService, EquipmentAssignmentsService, EquipmentUsageLogsService, MaintenanceService, EquipmentInsightsService],
})
export class EquipmentModule {}
