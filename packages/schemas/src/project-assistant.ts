import { z } from "zod";
import { uuidSchema } from "./common";

// api.md §13: POST /ai/conversations — "surface context {module, entity_ref}".
// Project Assistant (ai-spec.md §7.2) opens project-scoped threads;
// Executive Assistant (ai-spec.md §7.1, Phase 3) opens company-wide
// threads on the same endpoint/service — "company" carries no id since
// the tenant itself is the implicit scope (ai_conversations.entity_id
// stays null for these rows, same as its existing nullable-column
// comment anticipated).
export const entityRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), id: uuidSchema }),
  z.object({ type: z.literal("company") }),
]);
export type EntityRef = z.infer<typeof entityRefSchema>;

export const openConversationSchema = z.object({
  module: z.string().min(1),
  entityRef: entityRefSchema,
});
export type OpenConversationInput = z.infer<typeof openConversationSchema>;

export const postMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});
export type PostMessageInput = z.infer<typeof postMessageSchema>;

// ai-spec.md §6/§10: every source cited must trace back to a real,
// permission-checked record — never free-text invention.
export const assistantSourceSchema = z.object({
  entityType: z.string(),
  entityId: uuidSchema,
  title: z.string(),
});
export type AssistantSource = z.infer<typeof assistantSourceSchema>;

// ai-spec.md §7.2: "meeting-minute -> action-item drafting" / "next-best-
// action queue" — a draft artifact only, never persisted by the
// assistant itself (ai-spec §6: "draft ... visible only to the user, no
// gate"). The caller reviews and creates real tasks via the existing
// POST /projects/{id}/tasks endpoint.
export const suggestedTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  rationale: z.string().optional(),
});
export type SuggestedTask = z.infer<typeof suggestedTaskSchema>;

export const assistantMessageSchema = z.object({
  id: uuidSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  sources: z.array(assistantSourceSchema).optional(),
  suggestedTasks: z.array(suggestedTaskSchema).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  escalated: z.boolean().optional(),
  aiRunId: uuidSchema.nullable().optional(),
  createdAt: z.string(),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
