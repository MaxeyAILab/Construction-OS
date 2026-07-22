import type { Database } from "../../src/infrastructure/db/client";
import { ChangeOrderLifecycleService } from "../../src/modules/change-orders/application/change-order-lifecycle.service";
import { ChangeOrdersService } from "../../src/modules/change-orders/application/change-orders.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

export function buildTestChangeOrderServices(db: Database) {
  const outbox = new OutboxService();
  const changeOrdersService = new ChangeOrdersService(db, outbox);
  return {
    changeOrdersService,
    lifecycleService: new ChangeOrderLifecycleService(db, outbox, changeOrdersService),
  };
}
