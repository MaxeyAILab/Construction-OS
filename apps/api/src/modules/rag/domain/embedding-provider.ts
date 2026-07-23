// ai-spec.md §4 (NFR-28): "1024-dim (provider-abstracted)". Provider-
// agnostic like AiProvider (modules/ai) — VoyageEmbeddingProvider is the
// only implementation, injected via EMBEDDING_PROVIDER (rag.module.ts).
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_PROVIDER = Symbol("EMBEDDING_PROVIDER");
export const EMBEDDING_DIMENSIONS = 1024;
