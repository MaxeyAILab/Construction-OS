import { z } from "zod";
import type { AiTool } from "../../../ai";

const suggestedTaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  rationale: z.string().optional().describe("Why this task is being suggested"),
});

const inputSchema = z.object({
  tasks: z.array(suggestedTaskInputSchema).min(1).max(10),
});

// ai-spec.md §7.2: "meeting-minute -> action-item drafting" / "next-best-
// action queue" — ai-spec §6: "draft ... creates draft artifacts visible
// only to the user (no gate)." This tool has no side effects: calling it
// IS the structured answer (ai-spec §10.2's "structured outputs eliminate
// free-text invention" — the model can't slip a suggested task past zod
// validation the way it could if this were parsed out of prose). Nothing
// persists; the caller reviews suggestedTasks in the response and creates
// real tasks via the existing POST /projects/{id}/tasks endpoint.
export function buildSuggestTasksTool(): AiTool<z.infer<typeof inputSchema>> {
  return {
    name: "suggest_tasks",
    description:
      "Propose a list of follow-up tasks (e.g. from meeting notes, or as next-best-actions given the project's current risks). Does not create real tasks — purely a draft for the user to review.",
    inputSchema,
    permissionKey: "ai.conversation.create",
    consequenceClass: "draft",
    module: "ai",
    async execute(_ctx, input) {
      return input;
    },
  };
}
