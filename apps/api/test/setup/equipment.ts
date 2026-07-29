import type { Database } from "../../src/infrastructure/db/client";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import { CostTransactionsService } from "../../src/modules/budgets/application/cost-transactions.service";
import { EquipmentAssignmentsService } from "../../src/modules/equipment/application/equipment-assignments.service";
import { EquipmentFaultAlertsWriterService } from "../../src/modules/equipment/application/equipment-fault-alerts-writer.service";
import { EquipmentFaultAlertsService } from "../../src/modules/equipment/application/equipment-fault-alerts.service";
import { EquipmentInsightsService } from "../../src/modules/equipment/application/equipment-insights.service";
import { EquipmentUsageLogsService } from "../../src/modules/equipment/application/equipment-usage-logs.service";
import { EquipmentService } from "../../src/modules/equipment/application/equipment.service";
import { MaintenanceService } from "../../src/modules/equipment/application/maintenance.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { FakeAiProvider } from "./ai";

export function buildTestEquipmentServices(db: Database) {
  const outbox = new OutboxService();
  const equipmentService = new EquipmentService(db, outbox);
  const costTransactionsService = new CostTransactionsService(db, outbox);
  const maintenanceService = new MaintenanceService(db, outbox, equipmentService);
  const faultAlertsAiProvider = new FakeAiProvider();
  const faultAlertsService = new EquipmentFaultAlertsService(db, new AiGatewayService(db, faultAlertsAiProvider), outbox);
  return {
    equipmentService,
    assignmentsService: new EquipmentAssignmentsService(db, outbox, equipmentService),
    usageLogsService: new EquipmentUsageLogsService(db, outbox, equipmentService, costTransactionsService),
    maintenanceService,
    faultAlertsService,
    faultAlertsWriterService: new EquipmentFaultAlertsWriterService(faultAlertsService),
    faultAlertsAiProvider,
    insightsService: new EquipmentInsightsService(db, maintenanceService, faultAlertsService),
  };
}
