import type { Database } from "../../src/infrastructure/db/client";
import { CostTransactionsService } from "../../src/modules/budgets/application/cost-transactions.service";
import { EquipmentAssignmentsService } from "../../src/modules/equipment/application/equipment-assignments.service";
import { EquipmentUsageLogsService } from "../../src/modules/equipment/application/equipment-usage-logs.service";
import { EquipmentService } from "../../src/modules/equipment/application/equipment.service";
import { MaintenanceService } from "../../src/modules/equipment/application/maintenance.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

export function buildTestEquipmentServices(db: Database) {
  const outbox = new OutboxService();
  const equipmentService = new EquipmentService(db, outbox);
  const costTransactionsService = new CostTransactionsService(db, outbox);
  return {
    equipmentService,
    assignmentsService: new EquipmentAssignmentsService(db, outbox, equipmentService),
    usageLogsService: new EquipmentUsageLogsService(db, outbox, equipmentService, costTransactionsService),
    maintenanceService: new MaintenanceService(db, outbox, equipmentService),
  };
}
