// ai-spec.md §3: "structured records rendered via templates ... structure-
// aware beats raw dumps." One RagEntityRenderer per indexable entity type
// — same "registry, one more row per new entity" pattern the sync engine
// already established (modules/sync/application/entity-handlers.ts).
export interface RenderedEntity {
  title: string;
  text: string;
  projectId: string | null;
}

export interface RagEntityRenderer {
  entityType: string;
  // ai-spec.md §3 / architecture.md §7: "the retriever runs under the
  // caller's AccessContext" — RagSearchService checks this permission key
  // against the caller before a chunk of this entity type is ever
  // returned. This is the load-bearing security property of the whole
  // RAG layer (FR-AI-1/2): a user can never retrieve what they couldn't
  // open through the entity's own read endpoint.
  permissionKey: string;
  // Returns null for "not found" (including soft-deleted) — the indexer
  // treats that identically to an explicit tombstone/delete event.
  render(tenantId: string, entityId: string): Promise<RenderedEntity | null>;
}
