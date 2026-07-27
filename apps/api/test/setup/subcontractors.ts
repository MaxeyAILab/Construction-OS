import type { Database } from "../../src/infrastructure/db/client";
import { CertificationsService } from "../../src/modules/safety/application/certifications.service";
import { SubcontractorsService } from "../../src/modules/subcontractors/application/subcontractors.service";
import { SubcontractsService } from "../../src/modules/subcontractors/application/subcontracts.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

export function buildTestSubcontractorServices(db: Database) {
  const outbox = new OutboxService();
  const certificationsService = new CertificationsService(db, outbox);
  const subcontractorsService = new SubcontractorsService(db, outbox, certificationsService);
  return {
    certificationsService,
    subcontractorsService,
    subcontractsService: new SubcontractsService(db, outbox, subcontractorsService),
  };
}
