import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// database.md §19 (M17 RAG, ai-spec.md §3). Assumes the `vector` extension
// (pgvector) is already enabled on the instance — same "pre-installed,
// not migration-tracked" precedent as pgcrypto/citext/pg_trgm/btree_gin,
// none of which have a CREATE EXTENSION migration in this repo either
// (architecture.md's stack line names "PostgreSQL 16 (+pgvector)" as a
// baseline requirement, not something a migration provisions).
//
// `content` (the chunk's own rendered text) isn't in database.md's column
// list, which only names entity_type/entity_id/chunk_no/content_hash/
// embedding/meta — but ai-spec.md §3 requires citations to carry a
// `snippet`, and hybrid retrieval requires a keyword/FTS side, and
// neither is possible without storing the chunk text somewhere. Smallest
// spec-consistent addition, flagged here rather than silently invented.
export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    chunkNo: integer("chunk_no").notNull(),
    contentHash: text("content_hash").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    // Permission hints (database.md §19): projectId for project-scoped
    // entities, plus title (for citations without re-querying — and
    // re-checking RLS on — a source row that may itself be soft-deleted
    // by the time of a later search).
    meta: jsonb("meta").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ux_embeddings_tenant_entity_chunk_hash").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.chunkNo,
      table.contentHash,
    ),
    index("ix_embeddings_tenant_entity").on(table.tenantId, table.entityType, table.entityId),
    // HNSW (cosine ops) + the FTS GIN index both need raw SQL — drizzle-kit
    // doesn't generate either from a declarative builder — added in the
    // hand-written RLS/index migration alongside this table's RLS policy.
  ],
);
