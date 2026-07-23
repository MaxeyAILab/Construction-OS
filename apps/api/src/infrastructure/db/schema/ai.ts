import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

// database.md §19 (M17 AI Gateway, ai-spec.md §2). Every model invocation
// the AI Gateway makes — the backbone of FR-AI-4/6, NFR-27 metering, and
// the evaluation loop (ai-spec.md §13). Deliberately audit_log-shaped
// (no tenantColumns()): a run's tokens/cost/latency are a permanent fact
// about what happened and are never edited — only `outcome` is ever
// updated post-hoc (shown -> accepted/rejected/auto_applied/escalated) as
// the consuming product surface observes what the user did with it (see
// the immutability trigger in the RLS migration, which allows that one
// column to change and rejects everything else).
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    // null actorId = a background/system-triggered run (batch tagging,
    // scheduled briefings) rather than a live user request.
    actorId: uuid("actor_id").references(() => users.id),
    purpose: text("purpose").notNull(),
    // Nullable: not every gateway call originates from a versioned
    // template in packages/ai/prompts/ yet (none exist this pass — no
    // consuming AI feature has been built) — ai-spec.md §5's registry is
    // the intended source once one does.
    promptTemplateId: text("prompt_template_id"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    sources: jsonb("sources"),
    outcome: text("outcome").notNull().default("shown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "ck_ai_runs_outcome",
      sql`${table.outcome} in ('shown', 'accepted', 'rejected', 'auto_applied', 'escalated', 'error')`,
    ),
    check("ck_ai_runs_confidence_range", sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`),
    index("ix_ai_runs_tenant_created").on(table.tenantId, table.createdAt.desc()),
    index("ix_ai_runs_tenant_purpose_created").on(table.tenantId, table.purpose, table.createdAt.desc()),
  ],
);

// ai-spec.md §2: "per-tenant monthly AI budget (plan entitlement) ...
// soft limit = degrade ..., hard limit = assistant explains and offers
// top-up." One small, updatable config row per tenant — not append-only
// like ai_runs, since it's a setting, not a log. Current-month usage is
// computed on demand from ai_runs.cost_usd (AiGatewayService) rather than
// duplicated here as a running counter, so there's exactly one source of
// truth for spend.
export const aiBudgets = pgTable("ai_budgets", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => companies.id),
  monthlyLimitUsd: numeric("monthly_limit_usd", { precision: 10, scale: 2 }).notNull().default("50.00"),
  softLimitRatio: numeric("soft_limit_ratio", { precision: 3, scale: 2 }).notNull().default("0.80"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
