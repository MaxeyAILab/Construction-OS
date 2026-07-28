import type { Database } from "../../src/infrastructure/db/client";
import { EncryptionService } from "../../src/modules/auth";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { WebhookDispatchService } from "../../src/modules/webhooks/application/webhook-dispatch.service";
import { WebhooksService } from "../../src/modules/webhooks/application/webhooks.service";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

export function buildTestWebhookServices(db: Database) {
  const outbox = new OutboxService();
  const encryption = new EncryptionService(TEST_ENCRYPTION_KEY);
  const dispatchService = new WebhookDispatchService(db, outbox, encryption);
  const webhooksService = new WebhooksService(db, outbox, encryption, dispatchService);
  return { webhooksService, dispatchService };
}
