import { z } from "zod";
import { uuidSchema } from "./common";

// api.md §13: `POST /ai/search` — "NL semantic search (FR-AI-2):
// {query, scope?} → typed results with citations; permission-filtered at
// retrieval." scope.projectId narrows results to one project (ai-spec.md
// §7.11's "open RFIs on Riverside older than 2 weeks" example implies a
// project-scoped search is the common case).
export const searchQuerySchema = z.object({
  query: z.string().min(1),
  scope: z.object({ projectId: uuidSchema.optional() }).optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

// ai-spec.md §3: "every retrieved chunk carries {entity_type, entity_id,
// title, snippet}" — surfaced as source chips (ui §7 AIAnswerBlock).
export const searchResultSchema = z.object({
  entityType: z.string(),
  entityId: uuidSchema,
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
