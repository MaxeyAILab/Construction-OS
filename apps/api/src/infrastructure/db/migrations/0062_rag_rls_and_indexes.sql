-- Custom SQL migration file, put your code below! --

-- M17 RAG (ai-spec.md §3, database.md §19). No assign_tenant_audit_columns()
-- trigger — embeddings skips tenantColumns() entirely, same
-- "manages its own timestamp" precedent as sync_mutations/audit_log/ai_runs.

ALTER TABLE "embeddings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "embeddings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "embeddings"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- ai-spec.md §3: "HNSW index (RLS-scoped)". Cosine ops since retrieval
-- ranks by cosine similarity (RagSearchService uses drizzle's
-- cosineDistance() helper, which compiles to the <=> operator this index
-- accelerates).
CREATE INDEX "ix_embeddings_hnsw_cosine" ON "embeddings"
	USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- ai-spec.md §3: "hybrid — vector ... + keyword (Postgres FTS)". A
-- functional GIN index on to_tsvector(content) — drizzle-kit has no
-- declarative builder for functional/expression indexes, hence raw SQL
-- here rather than in the schema file's declarative index list.
CREATE INDEX "ix_embeddings_content_fts" ON "embeddings"
	USING gin (to_tsvector('english', "content"));
