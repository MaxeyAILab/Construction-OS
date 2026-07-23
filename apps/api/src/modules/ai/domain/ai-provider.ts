// architecture.md §7 / ai-spec.md §2 (NFR-28): "provider-agnostic adapter
// interface ... swappable without product changes." AiGatewayService only
// ever depends on this interface, never on a concrete provider SDK —
// AnthropicProvider is the only implementation today, injected via the
// AI_PROVIDER token (ai.module.ts) the same way S3_CLIENT is swappable in
// the files module.

// ai-spec.md §6: "tools are declared wrappers ... {name, description,
// params_schema}." The provider only needs the JSON-schema shape (not the
// zod schema itself) to hand to the model.
export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: unknown;
}

// A single conversation turn from the model's point of view. `tool_result`
// carries a prior tool call's real output back in — Anthropic's protocol
// nests these inside a user-role message, but callers of this interface
// don't need to know that; AnthropicProvider handles the translation.
export type AiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: AiToolCall[] }
  | { role: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface AiCompletionRequest {
  model: string;
  systemPrompt?: string;
  // Single-shot shorthand (back-compat with every caller that predates
  // tool-calling, e.g. AI Gateway's own tests) — exactly one of
  // userPrompt/messages must be set; AnthropicProvider treats userPrompt
  // as `messages: [{role:"user", content: userPrompt}]`.
  userPrompt?: string;
  messages?: AiMessage[];
  // ai-spec.md §6's tool registry, translated to the provider's native
  // tool-use format. Omitted entirely for plain completions.
  tools?: AiToolSpec[];
  // Forces the model to call this exact tool (Anthropic's `tool_choice`)
  // — used for structured-extraction calls where free-text is never an
  // acceptable answer (ai-spec §10.2).
  forceToolName?: string;
  maxTokens: number;
}

export interface AiCompletionResult {
  // Nullable/absent when the model's turn is entirely tool calls (Anthropic
  // returns no text block in that case).
  content: string | null;
  // Empty/absent when the model produced a final answer with no further
  // tool calls — the loop-ending condition callers check for.
  toolCalls?: AiToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");
