import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

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
    // database.md §6: the audit_log consumer needs to know who did this.
    // Nullable because not every event has a human actor (e.g. a future
    // scheduled/system-triggered event) — actorType distinguishes that
    // case from a real gap. No FK enforcement tying actorType to whether
    // actorId is set; callers are trusted to pass them consistently.
    actorId: uuid("actor_id").references(() => users.id),
    actorType: text("actor_type").notNull().default("user"),
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
    check(
      "ck_outbox_actor_type",
      sql`${table.actorType} in ('user', 'system', 'ai', 'integration')`,
    ),
  ],
);
