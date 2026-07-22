import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// Worker job audit / DLQ triage surface (database.md §20). Platform table
// (database.md §2, alongside migrations/platform_settings) — carries a
// nullable tenant ref rather than being RLS-scoped, since some jobs
// (the outbox relay itself) aren't tenant-scoped at all.
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").references(() => companies.id),
    queue: text("queue").notNull(),
    payloadHash: text("payload_hash"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("ix_job_runs_queue_status").on(table.queue, table.status)],
);
