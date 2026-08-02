import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { ApprovalInstancesService } from "../../src/modules/transmittals/application/approval-instances.service";
import { ApprovalMatricesService } from "../../src/modules/transmittals/application/approval-matrices.service";
import { TransmittalsService } from "../../src/modules/transmittals/application/transmittals.service";

export function buildTestTransmittalsServices(db: Database, permissions: PermissionResolverService) {
  const outbox = new OutboxService();
  const matricesService = new ApprovalMatricesService(db, outbox);
  return {
    transmittalsService: new TransmittalsService(db, outbox),
    matricesService,
    instancesService: new ApprovalInstancesService(db, outbox, matricesService, permissions),
  };
}
