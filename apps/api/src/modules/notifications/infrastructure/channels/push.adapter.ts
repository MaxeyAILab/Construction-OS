import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../../infrastructure/db/client";
import { pushDevices } from "../../../../infrastructure/db/schema";
import type {
  ChannelDeliveryResult,
  ChannelNotificationPayload,
  NotificationChannelAdapter,
} from "./channel.interface";

@Injectable()
export class PushChannel implements NotificationChannelAdapter {
  private readonly logger = new Logger(PushChannel.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async send(
    tenantId: string,
    userId: string,
    notification: ChannelNotificationPayload,
  ): Promise<ChannelDeliveryResult> {
    const devices = await withTenant(this.db, tenantId, (tx) =>
      tx.query.pushDevices.findMany({
        where: and(eq(pushDevices.tenantId, tenantId), eq(pushDevices.userId, userId)),
      }),
    );
    if (devices.length === 0) return { status: "skipped", reason: "no_registered_devices" };

    // No FCM/APNs credentials provisioned yet — logs in place of a real
    // send so the pipeline is exercisable end to end (see channel.interface.ts).
    for (const device of devices) {
      this.logger.log(
        `[stub push] platform=${device.platform} token=${device.pushToken.slice(0, 8)}… title="${notification.title}"`,
      );
    }
    return { status: "sent" };
  }
}
