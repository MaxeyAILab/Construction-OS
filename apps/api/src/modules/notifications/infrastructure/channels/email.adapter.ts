import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../infrastructure/db/client";
import { users } from "../../../../infrastructure/db/schema";
import type {
  ChannelDeliveryResult,
  ChannelNotificationPayload,
  NotificationChannelAdapter,
} from "./channel.interface";

@Injectable()
export class EmailChannel implements NotificationChannelAdapter {
  private readonly logger = new Logger(EmailChannel.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async send(
    _tenantId: string,
    userId: string,
    notification: ChannelNotificationPayload,
  ): Promise<ChannelDeliveryResult> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return { status: "skipped", reason: "user_not_found" };

    // No SES/Postmark credentials provisioned yet — logs in place of a real
    // send so the pipeline is exercisable end to end (see channel.interface.ts).
    this.logger.log(`[stub email] to=${user.email} subject="${notification.title}"`);
    return { status: "sent" };
  }
}
