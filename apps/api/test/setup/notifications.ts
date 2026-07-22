import type { Database } from "../../src/infrastructure/db/client";
import { DispatchService } from "../../src/modules/notifications/application/dispatch.service";
import { NotificationsService } from "../../src/modules/notifications/application/notifications.service";
import { EmailChannel } from "../../src/modules/notifications/infrastructure/channels/email.adapter";
import { PushChannel } from "../../src/modules/notifications/infrastructure/channels/push.adapter";

export function buildTestNotificationsServices(db: Database): {
  notificationsService: NotificationsService;
  dispatchService: DispatchService;
} {
  return {
    notificationsService: new NotificationsService(db),
    dispatchService: new DispatchService(db, new EmailChannel(db), new PushChannel(db)),
  };
}
