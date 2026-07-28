import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { users } from "./users";

// api.md §10: "GET/POST /integrations/accounting/… | admin.integration.manage
// | Connect, mapping, sync runs, conflict queue (FR-PLAT-8)." M18 Platform/
// Admin per spec.md's MVP table ("QuickBooks integration"). Only
// provider='quickbooks' has a real adapter today — 'sage'/'xero' are kept in
// the CHECK constraint to match database.md §11's accounting_links spec and
// roadmap.md's own sequencing (Sage/Xero depend on "accounting framework",
// i.e. this table existing), but connect() rejects anything but quickbooks
// at the service layer until those adapters are built.
export const accountingConnections = pgTable(
  "accounting_connections",
  {
    ...tenantColumns(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("pending"),
    // QuickBooks "company id" — assigned by Intuit at OAuth callback time,
    // null until then.
    realmId: text("realm_id"),
    // AES-256-GCM via EncryptionService (ACCOUNTING_ENCRYPTION_KEY), same
    // field-level-encryption precedent as users.mfa_secret_enc — these are
    // live OAuth credentials, not one-way-hashable like a password.
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    // { costCodeMappings: [{costCodeId, externalAccountId, externalAccountName}],
    // defaultExpenseAccountId } — the "mapping" half of api.md's row.
    // Resolves both push (cost code -> QB account) and pull-side conflict
    // display (QB account -> cost code) from one list.
    mapping: jsonb("mapping"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => [
    check("ck_accounting_connections_provider", sql`${table.provider} in ('quickbooks', 'sage', 'xero')`),
    check(
      "ck_accounting_connections_status",
      sql`${table.status} in ('pending', 'connected', 'disconnected', 'error')`,
    ),
    uniqueIndex("ux_accounting_connections_tenant_provider").on(table.tenantId, table.provider),
  ],
);

// database.md §11 exactly: "Mapping table for two-way sync (FR-PLAT-8):
// entity_type, entity_id, provider, external_id, last_synced_at, sync_state
// jsonb. Unique (tenant_id, provider, entity_type, external_id)." The join
// key between our rows and their QuickBooks-side counterparts — existence
// of a row here is what "already pushed" means (ix_costtxn_source's own
// comment: "idempotent sync upserts").
export const accountingLinks = pgTable(
  "accounting_links",
  {
    ...tenantColumns(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    syncState: jsonb("sync_state"),
  },
  (table) => [
    check("ck_accounting_links_provider", sql`${table.provider} in ('quickbooks', 'sage', 'xero')`),
    check("ck_accounting_links_entity_type", sql`${table.entityType} in ('cost_transaction')`),
    uniqueIndex("ux_accounting_links_tenant_provider_entity_external").on(
      table.tenantId,
      table.provider,
      table.entityType,
      table.externalId,
    ),
    index("ix_accounting_links_entity").on(table.tenantId, table.entityType, table.entityId),
  ],
);

// Job record for one push+pull sync execution — same "Postgres row the
// BullMQ worker updates as it runs" shape as export_jobs/import_jobs/
// report_runs.
export const accountingSyncRuns = pgTable(
  "accounting_sync_runs",
  {
    ...tenantColumns(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => accountingConnections.id),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    pushedCount: integer("pushed_count").notNull().default(0),
    pulledCount: integer("pulled_count").notNull().default(0),
    conflictCount: integer("conflict_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    error: text("error"),
  },
  (table) => [
    check("ck_accounting_sync_runs_provider", sql`${table.provider} in ('quickbooks', 'sage', 'xero')`),
    check(
      "ck_accounting_sync_runs_status",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed')`,
    ),
    index("ix_accounting_sync_runs_tenant_connection").on(table.tenantId, table.connectionId),
  ],
);

// The "conflict queue" half of api.md's row: a cost_transaction we pushed
// earlier has since been edited on the QuickBooks side (its remote amount
// no longer matches what we pushed) — surfaced for human resolution rather
// than silently overwritten either direction, since both are real user
// data (spec.md's "Live margin accuracy vs accounting" top-5 risk).
export const accountingSyncConflicts = pgTable(
  "accounting_sync_conflicts",
  {
    ...tenantColumns(),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => accountingSyncRuns.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    localValue: jsonb("local_value").notNull(),
    remoteValue: jsonb("remote_value").notNull(),
    status: text("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    check("ck_accounting_sync_conflicts_entity_type", sql`${table.entityType} in ('cost_transaction')`),
    check(
      "ck_accounting_sync_conflicts_status",
      sql`${table.status} in ('open', 'resolved_local', 'resolved_remote')`,
    ),
    index("ix_accounting_sync_conflicts_tenant_status").on(table.tenantId, table.status),
  ],
);
