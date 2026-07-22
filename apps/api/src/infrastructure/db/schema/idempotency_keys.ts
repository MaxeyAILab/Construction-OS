import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// api.md §1.7: "All POSTs accept Idempotency-Key header (UUID, 24h
// window)". Deliberately lean (no tenantColumns()) — this is an
// operational dedupe cache, not a domain entity: write-once per
// (tenant, endpoint, key), never updated, pruned by expiry (cleanup job
// not built yet — flagged as a follow-up; harmless to leave stale rows
// since the unique index is what matters, not table size at this scale).
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    // `${ControllerName}.${methodName}` — scopes a key to one logical
    // operation so the same UUID reused against a different endpoint
    // isn't treated as a replay.
    endpoint: text("endpoint").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("ux_idempotency_keys_tenant_endpoint_key").on(
      table.tenantId,
      table.endpoint,
      table.key,
    ),
  ],
);
