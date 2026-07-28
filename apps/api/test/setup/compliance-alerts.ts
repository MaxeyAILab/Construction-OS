import type { Database } from "../../src/infrastructure/db/client";
import { ComplianceAlertsQueryService } from "../../src/modules/compliance-alerts/application/compliance-alerts-query.service";
import { ComplianceAlertsService } from "../../src/modules/compliance-alerts/application/compliance-alerts.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

export function buildTestComplianceAlertsServices(db: Database) {
  const outbox = new OutboxService();
  return {
    complianceAlertsService: new ComplianceAlertsService(db, outbox),
    complianceAlertsQueryService: new ComplianceAlertsQueryService(db),
  };
}
