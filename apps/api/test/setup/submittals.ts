import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { SubmittalsService } from "../../src/modules/submittals/application/submittals.service";

export function buildTestSubmittalsServices(db: Database) {
  const outbox = new OutboxService();
  return { submittalsService: new SubmittalsService(db, outbox) };
}
