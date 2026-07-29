import { Injectable } from "@nestjs/common";
import type { EquipmentInspectionCreatedV1, OutboxEnvelope } from "@constructionos/schemas";
import { EquipmentFaultAlertsService } from "./equipment-fault-alerts.service";

// FR-EQ-4: reacts only to failed inspections — a passing inspection can
// never extend a fault pattern, same "only the mutation that could
// possibly matter triggers a check" precedent as
// FinanceAlertsWriterService filtering to budget_line.updated.v1.
@Injectable()
export class EquipmentFaultAlertsWriterService {
  constructor(private readonly faultAlerts: EquipmentFaultAlertsService) {}

  async handleEnvelope(envelope: OutboxEnvelope): Promise<void> {
    if (envelope.eventType !== "equipment_inspection.created.v1") return;

    const payload = envelope.payload as EquipmentInspectionCreatedV1;
    if (!payload.passed) {
      await this.faultAlerts.checkEquipment(envelope.tenantId, payload.equipmentId);
    }
  }
}
