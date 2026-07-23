// Single source of truth for "what permission does a caller need to see a
// chunk of this entity type" — shared by the indexing renderers (which
// entity type is indexable) and RagSearchService (which permission gates
// retrieval). ai-spec.md §3: "the retriever runs under the caller's
// AccessContext" — this map IS that AccessContext for RAG.
export const ENTITY_PERMISSIONS: Record<string, string> = {
  task: "tasks.task.read",
  rfi: "docs.rfi.read",
  daily_report: "field.daily_report.read",
  photo: "field.photo.read",
};
