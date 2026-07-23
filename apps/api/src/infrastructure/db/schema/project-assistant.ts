import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

// database.md §19 (M17 Project Assistant, ai-spec.md §7.2): "Assistant
// threads per user + surface context (module, entity_ref)." Polymorphic
// entityType/entityId pointer — same precedent as notifications' and
// audit_log's entity_type/entity_id (no FK possible across multiple
// target tables). This row's only producer (Project Assistant) always
// sets module='project' + entityType='project', but the columns stay
// generic per api.md §13's contract for whenever Executive Assistant
// (ai-spec §7.1, a later roadmap row) opens company-wide threads.
//
// No tenantColumns(): a conversation is create-once metadata with no
// defined edit/archive use-case in any spec doc (api.md §13 lists no
// PATCH/DELETE) — adding soft-delete/updated_seq machinery nothing ever
// sets would be dead weight (same "ai_runs-shaped, not tenantColumns()"
// reasoning already used for that table).
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    module: text("module").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_ai_conversations_tenant_user_created").on(table.tenantId, table.userId, table.createdAt.desc())],
);

// database.md §19: "messages store role, content, tool_calls jsonb, token
// counts." Append-only, never edited once posted — same "audit_log-shaped"
// immutability as ai_runs (see the RLS migration's reject-all trigger) —
// only 'user'/'assistant' roles are ever persisted here; the LLM's
// internal tool_use/tool_result turns are transient loop state
// (tool-runner.service.ts), reconstructable from the assistant row's own
// tool_calls jsonb if ever needed, not separately persisted as rows.
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_ai_messages_role", sql`${table.role} in ('user', 'assistant')`),
    index("ix_ai_messages_tenant_conversation_created").on(table.tenantId, table.conversationId, table.createdAt),
  ],
);
