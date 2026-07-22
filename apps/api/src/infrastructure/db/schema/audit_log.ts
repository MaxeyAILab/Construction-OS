import { sql } from "drizzle-orm";
import { check, index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

// database.md §6: immutable record of privileged, financial, permission,
// and AI actions (FR-PLAT-4, FR-RBAC-4, FR-AI-6). Written by the outbox
// consumer (audit.module.ts's AuditConsumerWorker), not inline by
// use-cases — same "bus consumer" shape as the notification service.
//
// No tenantColumns(): this table is deliberately lean and has no
// updated_at/updated_seq (nothing about a row is ever supposed to change)
// and no soft-delete (rows are never deleted either — see the immutability
// trigger in 00XX_audit_log_rls_and_immutability.sql).
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    // null actorId = system/AI-initiated (ai_run_id set in that case).
    actorId: uuid("actor_id").references(() => users.id),
    actorType: text("actor_type").notNull(),
    // No FK yet: ai_runs (M17, Phase 1D) doesn't exist. Add the reference
    // once the AI Gateway module lands.
    aiRunId: uuid("ai_run_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    traceId: text("trace_id"),
  },
  (table) => [
    check(
      "ck_audit_log_actor_type",
      sql`${table.actorType} in ('user', 'system', 'ai', 'integration')`,
    ),
    index("ix_audit_tenant_entity").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.occurredAt.desc(),
    ),
    index("ix_audit_tenant_actor").on(table.tenantId, table.actorId, table.occurredAt.desc()),
  ],
);
