import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

// database.md §20: "Server-side applied-mutation log... idempotency + the
// audit trail for NFR-10 ('nothing lost, ever')." No tenantColumns():
// like audit_log, this is deliberately lean — no updated_seq/soft-delete,
// since nothing about a row's identity (client_id/mutation_id/entity)
// ever changes. Unlike audit_log, `result`/`conflict_detail` DO get
// updated once, by POST /sync/conflicts/{id}/resolve moving a row from
// 'conflict' to 'applied' — not a true immutability guarantee, just "no
// other field ever changes after insert."
export const syncMutations = pgTable(
  "sync_mutations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    // The device that captured the mutation offline — not the same as
    // user_id (one user, multiple devices) — architecture.md §14.2's
    // mutation-record shape.
    clientId: text("client_id").notNull(),
    // Client-generated (mobile can mint uuids offline, database.md §1's
    // "UUIDv7... mobile can generate ids offline" principle) — the
    // idempotency key. Unique per tenant: a retried upload with the same
    // mutation_id is a no-op replay, not reprocessed.
    mutationId: uuid("mutation_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    op: text("op").notNull(),
    // Client's offline capture time (architecture.md §14.2: "offline time
    // still ordered") — distinct from applied_at (server processing time).
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    result: text("result").notNull(),
    // Present only when result='conflict': what the server had vs. what
    // the client sent, for the human resolution queue (NFR-12) to render.
    conflictDetail: jsonb("conflict_detail"),
  },
  (table) => [
    check("ck_sync_mutations_op", sql`${table.op} in ('create', 'update', 'delete')`),
    check(
      "ck_sync_mutations_result",
      sql`${table.result} in ('applied', 'merged', 'conflict', 'rejected')`,
    ),
    uniqueIndex("ux_sync_mutations_tenant_mutation").on(table.tenantId, table.mutationId),
    index("ix_sync_mutations_tenant_user_applied").on(table.tenantId, table.userId, table.appliedAt.desc()),
    index("ix_sync_mutations_tenant_result").on(table.tenantId, table.result),
  ],
);
