import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { RfisService } from "../../src/modules/rfis/application/rfis.service";

export function buildTestRfisServices(db: Database) {
  const outbox = new OutboxService();
  return { rfisService: new RfisService(db, outbox) };
}
