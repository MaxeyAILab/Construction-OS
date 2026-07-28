import { sql } from "drizzle-orm";
import { check, index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { users } from "./users";

// api.md §15.1 "Agent identities" (ai-spec.md §15, roadmap "Agent runtime
// GA"). An agent is a `users` row (kind='agent' on its company_users
// membership) plus this extension table for AI-specific metadata — not a
// new principal type, so every permission-resolution/audit path a human
// user already goes through is reused unmodified (userId's role
// assignment lives in the ordinary user_roles table, not here).
export const agentIdentities = pgTable(
  "agent_identities",
  {
    ...tenantColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("active"),
    // Validated against the live tool-runner registry at declare/update
    // time (AgentIdentitiesService) — same "validate against the real
    // catalog" precedent as api_keys.scopes[] (api.md §16.4).
    toolAllowlist: text("tool_allowlist")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    budgetMonthlyUsd: numeric("budget_monthly_usd", { precision: 10, scale: 2 }),
    // string[] of notification emails — ai-spec.md §15's "escalation
    // contacts" isn't necessarily a set of platform users (e.g. an
    // on-call distribution list), so this is deliberately not a user_id
    // array.
    escalationContacts: jsonb("escalation_contacts").notNull().default(sql`'[]'::jsonb`),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedBy: uuid("paused_by").references(() => users.id),
  },
  (table) => [
    check("ck_agent_identities_status", sql`${table.status} in ('active', 'paused')`),
    index("ix_agent_identities_tenant").on(table.tenantId),
  ],
);
