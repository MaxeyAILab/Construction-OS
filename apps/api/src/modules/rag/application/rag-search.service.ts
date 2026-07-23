import { Inject, Injectable } from "@nestjs/common";
import type { SearchQuery, SearchResult } from "@constructionos/schemas";
import { and, cosineDistance, eq, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { embeddings } from "../../../infrastructure/db/schema";
import { PermissionResolverService } from "../../rbac/application/permission-resolver.service";
import { ENTITY_PERMISSIONS } from "../domain/entity-permissions";
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from "../domain/embedding-provider";
import { fuseRrf } from "../domain/rrf";

// ai-spec.md §3: "hybrid ... fused via RRF, then cross-encoder rerank
// (small model) of top-40 → top-8." The cross-encoder rerank stage is
// deliberately not implemented — it's a genuinely separate model/service
// this stack doesn't have yet, and no specific provider is named beyond
// "small model" (flagged follow-up, not silently skipped); this returns
// the top RESULT_LIMIT straight from RRF fusion of the two top-RETRIEVAL_LIMIT
// candidate lists instead.
const RETRIEVAL_LIMIT = 40;
const RESULT_LIMIT = 8;
const SNIPPET_LENGTH = 240;

interface CandidateRow {
  id: string;
  entityType: string;
  entityId: string;
  content: string;
  meta: unknown;
}

@Injectable()
export class RagSearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    private readonly permissions: PermissionResolverService,
  ) {}

  // api.md §13: `POST /ai/search` (FR-AI-2). ai-spec.md §3's load-bearing
  // security property: retrieval runs under the caller's AccessContext —
  // a chunk is only ever returned if the caller holds that entity type's
  // read permission (checked here, after fusion, before any chunk is
  // even counted toward the RESULT_LIMIT).
  async search(tenantId: string, actorId: string, query: SearchQuery): Promise<SearchResult[]> {
    const [queryVector] = await this.embeddingProvider.embed([query.query]);
    const granted = new Set(await this.permissions.resolve(tenantId, actorId));

    const fused = await withTenant(this.db, tenantId, async (tx) => {
      const scopeCondition = query.scope?.projectId
        ? sql`(${embeddings.meta}->>'projectId') = ${query.scope.projectId}`
        : sql`true`;

      const columns = {
        id: embeddings.id,
        entityType: embeddings.entityType,
        entityId: embeddings.entityId,
        content: embeddings.content,
        meta: embeddings.meta,
      };

      const vectorRows = await tx
        .select(columns)
        .from(embeddings)
        .where(and(eq(embeddings.tenantId, tenantId), scopeCondition))
        .orderBy(cosineDistance(embeddings.embedding, queryVector!))
        .limit(RETRIEVAL_LIMIT);

      const ftsRows = await tx
        .select(columns)
        .from(embeddings)
        .where(
          and(
            eq(embeddings.tenantId, tenantId),
            scopeCondition,
            sql`to_tsvector('english', ${embeddings.content}) @@ plainto_tsquery('english', ${query.query})`,
          ),
        )
        .orderBy(sql`ts_rank(to_tsvector('english', ${embeddings.content}), plainto_tsquery('english', ${query.query})) desc`)
        .limit(RETRIEVAL_LIMIT);

      return fuseRrf<CandidateRow>(vectorRows, ftsRows);
    });

    const results: SearchResult[] = [];
    for (const row of fused) {
      const permissionKey = ENTITY_PERMISSIONS[row.entityType];
      if (!permissionKey || !granted.has(permissionKey)) continue;

      const meta = row.meta as { title?: string };
      results.push({
        entityType: row.entityType,
        entityId: row.entityId,
        title: meta.title ?? "",
        snippet: row.content.slice(0, SNIPPET_LENGTH),
        score: row.score,
      });
      if (results.length >= RESULT_LIMIT) break;
    }
    return results;
  }
}
