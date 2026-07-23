import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { embeddings } from "../../../infrastructure/db/schema";
import { DailyReportsService } from "../../daily-reports/application/daily-reports.service";
import { RfisService } from "../../rfis/application/rfis.service";
import { TasksService } from "../../tasks/application/tasks.service";
import { chunkText, hashContent } from "../domain/chunker";
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from "../domain/embedding-provider";
import type { RagEntityRenderer } from "../domain/entity-renderer";
import { buildEntityRenderers } from "./entity-renderers";

// ai-spec.md §3: "outbox event → embedding worker → chunk → embed →
// upsert embeddings ... HNSW index." Re-renders and re-chunks an entity
// from source on every call rather than diffing — same "recompute-and-
// replace, trivially idempotent under at-least-once delivery" reasoning
// DashboardProjectionsWriterService already uses for projection_* tables.
//
// This always re-embeds every chunk of a changed entity (not just chunks
// whose content actually changed) — database.md §19's content_hash
// column still does its documented job of preventing an exact-duplicate
// row under a retried delivery, but the "skip re-embedding an unchanged
// chunk to save an API call" optimization it also enables is deferred
// (flagged follow-up, not silently dropped): today's indexed entities
// (tasks/RFIs/daily reports) are small enough that this is a real but
// modest cost, not a correctness issue.
@Injectable()
export class RagIndexingService {
  private readonly renderers: Record<string, RagEntityRenderer>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    tasksService: TasksService,
    rfisService: RfisService,
    dailyReportsService: DailyReportsService,
  ) {
    this.renderers = buildEntityRenderers(tasksService, rfisService, dailyReportsService);
  }

  isIndexed(entityType: string): boolean {
    return entityType in this.renderers;
  }

  async indexEntity(tenantId: string, entityType: string, entityId: string): Promise<void> {
    const renderer = this.renderers[entityType];
    if (!renderer) return; // not an indexed entity type — no-op, not an error

    const rendered = await renderer.render(tenantId, entityId);
    if (!rendered) {
      await this.removeEntity(tenantId, entityType, entityId);
      return;
    }

    const chunks = chunkText(rendered.text);
    if (chunks.length === 0) {
      await this.removeEntity(tenantId, entityType, entityId);
      return;
    }

    const vectors = await this.embeddingProvider.embed(chunks);

    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .delete(embeddings)
        .where(and(eq(embeddings.tenantId, tenantId), eq(embeddings.entityType, entityType), eq(embeddings.entityId, entityId)));

      await tx.insert(embeddings).values(
        chunks.map((chunk, i) => ({
          tenantId,
          entityType,
          entityId,
          chunkNo: i,
          contentHash: hashContent(chunk),
          content: chunk,
          embedding: vectors[i]!,
          meta: { title: rendered.title, projectId: rendered.projectId },
        })),
      );
    });
  }

  // ai-spec.md §3: "deletes/tombstones purge vectors synchronously with
  // source soft-delete."
  async removeEntity(tenantId: string, entityType: string, entityId: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .delete(embeddings)
        .where(and(eq(embeddings.tenantId, tenantId), eq(embeddings.entityType, entityType), eq(embeddings.entityId, entityId))),
    );
  }
}
