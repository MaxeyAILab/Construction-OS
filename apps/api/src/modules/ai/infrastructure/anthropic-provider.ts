import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
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
      messages: toAnthropicMessages(request),
      ...(request.tools && { tools: request.tools.map(toAnthropicTool) }),
      ...(request.forceToolName && { tool_choice: { type: "tool", name: request.forceToolName } }),
    });

    const textBlocks = response.content.filter((block) => block.type === "text");
    const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");

    if (textBlocks.length === 0 && toolUseBlocks.length === 0) {
      throw new Error("Anthropic response contained no text or tool_use block");
    }

    return {
      content: textBlocks.length > 0 ? textBlocks.map((b) => b.text).join("\n\n") : null,
      toolCalls: toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

// AiToolSpec.inputSchema is provider-agnostic JSON schema (drizzle/zod
// callers never import an Anthropic type); this is the one place it's
// asserted into the SDK's stricter `{type:'object', ...}` shape — every
// caller in this codebase builds it from a zod schema's own `type:
// "object"` root, so the assertion holds by construction.
function toAnthropicTool(spec: { name: string; description: string; inputSchema: Record<string, unknown> }): Tool {
  return { name: spec.name, description: spec.description, input_schema: spec.inputSchema as Tool.InputSchema };
}

// ai-spec.md §6's tool-calling loop needs multi-turn conversation history
// (assistant tool_use -> tool_result -> assistant final answer).
// Anthropic requires tool_result blocks to live inside a `user`-role
// message, with consecutive results from one turn's parallel tool calls
// batched into a single message rather than one message per result — this
// coalesces this interface's flat per-call `tool_result` entries into
// that shape.
function toAnthropicMessages(request: AiCompletionRequest): MessageParam[] {
  if (!request.messages) {
    return [{ role: "user", content: request.userPrompt ?? "" }];
  }

  const messages: MessageParam[] = [];
  let pendingToolResults: ToolResultBlockParam[] | null = null;

  const flushToolResults = () => {
    if (pendingToolResults) {
      messages.push({ role: "user", content: pendingToolResults });
      pendingToolResults = null;
    }
  };

  for (const msg of request.messages) {
    if (msg.role === "user") {
      flushToolResults();
      if (msg.images && msg.images.length > 0) {
        messages.push({
          role: "user",
          content: [
            ...msg.images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mediaType, data: img.base64Data },
            })),
            { type: "text", text: msg.content },
          ],
        });
      } else {
        messages.push({ role: "user", content: msg.content });
      }
      continue;
    }
    if (msg.role === "assistant") {
      flushToolResults();
      const blocks: MessageParam["content"] = [];
      if (msg.content) blocks.push({ type: "text", text: msg.content });
      for (const call of msg.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      messages.push({ role: "assistant", content: blocks });
      continue;
    }
    // tool_result — accumulate; flushed on the next non-tool_result
    // message or at the end, batching one turn's parallel calls together.
    const block: ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: msg.toolCallId,
      content: msg.content,
      ...(msg.isError && { is_error: true }),
    };
    (pendingToolResults ??= []).push(block);
  }
  flushToolResults();
  return messages;
}
