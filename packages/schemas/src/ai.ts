import { z } from "zod";
import { isoDateTimeSchema, paginationQuerySchema } from "./common";

// database.md §19: ai_runs.outcome CHECK — the outcome-distribution
// lifecycle ai-spec.md §12 tracks (shown -> accepted/rejected/
// auto_applied/escalated), plus 'error' for a failed invocation.
export const aiRunOutcomeSchema = z.enum([
  "shown",
  "accepted",
  "rejected",
  "auto_applied",
  "escalated",
  "error",
]);
export type AiRunOutcome = z.infer<typeof aiRunOutcomeSchema>;

// api.md §13: `GET /ai/runs` — "Tenant AI audit/usage (filter[purpose],
// cost aggregates — NFR-27)".
export const listAiRunsQuerySchema = paginationQuerySchema.extend({
  purpose: z.string().optional(),
  outcome: aiRunOutcomeSchema.optional(),
  createdFrom: isoDateTimeSchema.optional(),
  createdTo: isoDateTimeSchema.optional(),
});
export type ListAiRunsQuery = z.infer<typeof listAiRunsQuerySchema>;

// api.md §13's `/ai/conversations/{id}/messages` SSE contract isn't built
// this pass (no consuming assistant feature exists yet — this row is the
// gateway infrastructure only); this is the shape AiGatewayService.run()
// takes today for any future caller.
export const aiRunRequestSchema = z.object({
  purpose: z.string().min(1),
  promptTemplateId: z.string().optional(),
  model: z.string().min(1),
  systemPrompt: z.string().optional(),
  userPrompt: z.string().min(1),
  maxTokens: z.number().int().positive().max(8192).default(1024),
});
export type AiRunRequest = z.infer<typeof aiRunRequestSchema>;
