import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { users } from "./users";

// database.md §18 (M18). Per-recipient in-app record — this IS the "in-app"
// delivery (architecture.md §10: "In-app notifications persisted"), not
// just a log of an external send.
export const notifications = pgTable(
  "notifications",
  {
    ...tenantColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    // Per-channel delivery status (database.md §18), e.g.
    // {"email": {"status": "sent", "at": "..."}, "push": {"status": "skipped", "reason": "no_device"}}.
    channelState: jsonb("channel_state").notNull().default({}),
    priority: text("priority").notNull().default("normal"),
  },
  (table) => [
    check(
      "ck_notifications_priority",
      sql`${table.priority} in ('low', 'normal', 'high', 'critical')`,
    ),
    // database.md §18's documented index, for the "unread inbox" query.
    index("ix_notif_tenant_user_unread")
      .on(table.tenantId, table.userId)
      .where(sql`${table.readAt} is null`),
  ],
);

// database.md §18: `(user_id, category, digest)` matrix. `category` is a
// free-text event-kind grouping (e.g. "user.invited") rather than an enum —
// new event types shouldn't require a migration to become preference-able.
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    ...tenantColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    digest: text("digest").notNull().default("instant"),
  },
  (table) => [
    check(
      "ck_notification_prefs_channel",
      sql`${table.channel} in ('in_app', 'email', 'push', 'sms')`,
    ),
    check("ck_notification_prefs_digest", sql`${table.digest} in ('instant', 'hourly', 'daily')`),
    uniqueIndex("ux_notification_prefs").on(
      table.tenantId,
      table.userId,
      table.category,
      table.channel,
    ),
  ],
);

// api.md §12 `POST /devices` — push token registry backing the "push"
// channel adapter. Not separately named in database.md §18, but the
// endpoint is part of the documented Notifications API contract.
export const pushDevices = pgTable(
  "push_devices",
  {
    ...tenantColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    platform: text("platform").notNull(),
    pushToken: text("push_token").notNull(),
    deviceName: text("device_name"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_push_devices_platform", sql`${table.platform} in ('ios', 'android', 'web')`),
    uniqueIndex("ux_push_devices_token").on(table.tenantId, table.pushToken),
  ],
);
