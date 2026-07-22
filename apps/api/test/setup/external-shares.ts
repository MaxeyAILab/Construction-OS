import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";

export function buildTestExternalSharesService(db: Database): { externalSharesService: ExternalSharesService } {
  return { externalSharesService: new ExternalSharesService(db, new OutboxService()) };
}
