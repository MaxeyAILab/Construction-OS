import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// Transactional outbox (architecture.md §8, database.md §20): written in
// the same transaction as the domain change, relayed to NATS by a
// separate worker, then stamped published_at. Append-only like
// webhook_deliveries — no updated_at/deleted_at/updated_seq, a lean shape
// distinct from tenantColumns().
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    // Lease for at-least-once relay (architecture.md §8: "delivery is
    // at-least-once"): a relay worker claims a row by setting claimedAt,
    // then publishes to NATS, then sets publishedAt. A row whose lease
    // expired without publishing becomes reclaimable — never silently
    // dropped, worst case is a harmless duplicate publish (consumers
    // dedupe via dedupeKey).
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ux_outbox_dedupe_key").on(table.dedupeKey),
    index("ix_outbox_tenant_published").on(table.tenantId, table.publishedAt),
  ],
);
