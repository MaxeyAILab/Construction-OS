import Anthropic from "@anthropic-ai/sdk";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../domain/ai-provider";

// architecture.md §7: "frontier model (Claude-class) for assistants/agents
// and complex drafting" — the default/only provider at MVP (NFR-28's
// adapter interface is what makes adding a second one a config change,
// not a rewrite).
//
// Constructing the SDK client never dials the network (same "safe to
// build eagerly against an unconfigured key" reasoning as StorageService's
// S3Client) — it only throws when a request actually tries to sign
// itself, which is exactly when config/env.ts's optional
// ANTHROPIC_API_KEY hasn't been provisioned yet.
export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string | undefined) {
    this.client = new Anthropic({ apiKey: apiKey ?? null });
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      ...(request.systemPrompt && { system: request.systemPrompt }),
      messages: [{ role: "user", content: request.userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock) throw new Error("Anthropic response contained no text block");

    return {
      content: textBlock.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
