import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { notificationPreferences, notifications } from "../../../infrastructure/db/schema";
import { draftNotifications } from "../domain/event-notification-map";
import {
  type ChannelDeliveryResult,
  EMAIL_CHANNEL,
  type NotificationChannelAdapter,
  PUSH_CHANNEL,
} from "../infrastructure/channels/channel.interface";

const CHANNELS = ["in_app", "email", "push"] as const;
type Channel = (typeof CHANNELS)[number];

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_CHANNEL) private readonly emailChannel: NotificationChannelAdapter,
    @Inject(PUSH_CHANNEL) private readonly pushChannel: NotificationChannelAdapter,
  ) {}

  async handleEnvelope(envelope: OutboxEnvelope): Promise<void> {
    const drafts = draftNotifications(envelope);
    if (drafts.length === 0) return; // no notification mapping for this event type — not an error

    await withTenant(this.db, envelope.tenantId, async (tx) => {
      for (const draft of drafts) {
        const preferences = await this.resolvePreferences(
          tx,
          envelope.tenantId,
          draft.recipientUserId,
          draft.category,
        );

        const channelState: Record<string, ChannelDeliveryResult> = {};

        // The row itself IS the in-app delivery (architecture.md §10: "In-app
        // notifications persisted"), so recording its own status is just
        // bookkeeping for a uniform channel_state shape.
        channelState.in_app = preferences.in_app
          ? { status: "sent" }
          : { status: "skipped", reason: "preference_disabled" };

        channelState.email = preferences.email
          ? await this.emailChannel.send(envelope.tenantId, draft.recipientUserId, draft)
          : { status: "skipped", reason: "preference_disabled" };

        channelState.push = preferences.push
          ? await this.pushChannel.send(envelope.tenantId, draft.recipientUserId, draft)
          : { status: "skipped", reason: "preference_disabled" };

        await tx.insert(notifications).values({
          tenantId: envelope.tenantId,
          userId: draft.recipientUserId,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          entityType: draft.entityType,
          entityId: draft.entityId,
          channelState,
        });
      }
    });

    this.logger.debug(`dispatched notification for ${envelope.eventType} (${envelope.id})`);
  }

  // Digesting/batching (architecture.md §10: "17 tasks updated, not 17
  // pings") is not implemented yet — every preference row's `digest` value
  // is accepted but only "instant" delivery actually happens. Flagged as a
  // follow-up rather than invented here.
  private async resolvePreferences(
    tx: Database,
    tenantId: string,
    userId: string,
    category: string,
  ): Promise<Record<Channel, boolean>> {
    const rows = await tx.query.notificationPreferences.findMany({
      where: and(
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.category, category),
      ),
    });

    const result = { in_app: true, email: true, push: true } as Record<Channel, boolean>;
    for (const row of rows) {
      if (CHANNELS.includes(row.channel as Channel)) {
        result[row.channel as Channel] = row.enabled;
      }
    }
    return result;
  }
}
