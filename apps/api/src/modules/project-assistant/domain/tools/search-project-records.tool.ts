import { z } from "zod";
import type { AiTool } from "../../../ai";
import type { RagSearchService } from "../../../rag";

const inputSchema = z.object({
  query: z.string().min(1).describe("Natural-language search text"),
});

// ai-spec.md §7.2: "cross-record search." Wraps the already-permission-
// filtered RagSearchService (RAG pipeline row) rather than re-deriving
// hybrid retrieval — the tool's own permissionKey (ai.search.read) gates
// whether the model is offered this tool at all; RagSearchService.search
// itself independently re-checks per-entity-type permissions on every
// retrieved chunk (ai-spec §3's "load-bearing security property"),
// so this stays safe even if that first gate were ever misconfigured.
export function buildSearchProjectRecordsTool(ragSearch: RagSearchService, projectId: string): AiTool<z.infer<typeof inputSchema>> {
  return {
    name: "search_project_records",
    description:
      "Search this project's tasks, RFIs, and daily reports by natural-language query. Returns the most relevant matching records with citations.",
    inputSchema,
    permissionKey: "ai.search.read",
    consequenceClass: "read",
    module: "ai",
    async execute(ctx, input) {
      return ragSearch.search(ctx.tenantId, ctx.actorId, { query: input.query, scope: { projectId } });
    },
  };
}
