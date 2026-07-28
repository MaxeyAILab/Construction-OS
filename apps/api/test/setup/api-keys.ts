import type { Database } from "../../src/infrastructure/db/client";
import { ApiKeysService } from "../../src/modules/auth/application/api-keys.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

export function buildTestApiKeysService(db: Database): ApiKeysService {
  return new ApiKeysService(db, new OutboxService());
}
