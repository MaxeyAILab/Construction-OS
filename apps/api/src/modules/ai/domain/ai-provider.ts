// architecture.md §7 / ai-spec.md §2 (NFR-28): "provider-agnostic adapter
// interface ... swappable without product changes." AiGatewayService only
// ever depends on this interface, never on a concrete provider SDK —
// AnthropicProvider is the only implementation today, injected via the
// AI_PROVIDER token (ai.module.ts) the same way S3_CLIENT is swappable in
// the files module.
export interface AiCompletionRequest {
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens: number;
}

export interface AiCompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");
