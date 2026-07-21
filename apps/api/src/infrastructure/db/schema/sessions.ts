import { sql } from "drizzle-orm";
import { boolean, index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns, idColumn } from "./columns";
import { companies } from "./companies";
import { users } from "./users";

// Refresh-token family tracking, device binding, revocation (database.md §7,
// architecture.md §11). tenantId is the session's active company context —
// access tokens carry tenant_id as a claim, so switching companies means a
// new session, not mutating this row's tenant.
export const sessions = pgTable(
  "sessions",
  {
    ...tenantColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    deviceId: text("device_id"),
    deviceName: text("device_name"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("ix_sessions_tenant_user").on(table.tenantId, table.userId)],
);

// Hashed keys, scopes, last_used_at (database.md §7 — public API / integrations).
export const apiKeys = pgTable(
  "api_keys",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("ix_api_keys_tenant").on(table.tenantId)],
);

// Tenant URL + secret + subscribed event types (database.md §7).
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    ...tenantColumns(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    subscribedEvents: text("subscribed_events")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [index("ix_webhook_endpoints_tenant").on(table.tenantId)],
);

// Attempt log (database.md §7): append-only, no soft-delete/update columns —
// bias field/log data to append-only (database.md §1.4). Partitioning by
// month + 90-day pruning is a follow-up once volume warrants it.
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    ...idColumn,
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    webhookEndpointId: uuid("webhook_endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    responseStatus: text("response_status"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_webhook_deliveries_tenant_endpoint").on(table.tenantId, table.webhookEndpointId),
  ],
);
