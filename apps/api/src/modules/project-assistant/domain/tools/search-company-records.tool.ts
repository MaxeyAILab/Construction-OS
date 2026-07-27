import { z } from "zod";
import type { AiTool } from "../../../ai";
import type { RagSearchService } from "../../../rag";

const inputSchema = z.object({
  query: z.string().min(1).describe("Natural-language search text"),
});

// ai-spec.md §7.1: "NL company Q&A ... with sources." Same
// RagSearchService.search wrapper as search_project_records, but with no
// scope.projectId — RagSearchService already treats an omitted scope as
// tenant-wide (rag-search.service.ts's scopeCondition falls back to
// `sql\`true\`` when scope.projectId is absent), so this reuses that
// existing behavior rather than adding a second retrieval path.
export function buildSearchCompanyRecordsTool(ragSearch: RagSearchService): AiTool<z.infer<typeof inputSchema>> {
  return {
    name: "search_company_records",
    description:
      "Search across all of this company's projects — tasks, RFIs, and daily reports — by natural-language query. Returns the most relevant matching records with citations.",
    inputSchema,
    permissionKey: "ai.search.read",
    consequenceClass: "read",
    module: "ai",
    async execute(ctx, input) {
      return ragSearch.search(ctx.tenantId, ctx.actorId, { query: input.query });
    },
  };
}
