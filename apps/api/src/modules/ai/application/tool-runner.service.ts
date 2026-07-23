import { Injectable } from "@nestjs/common";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AiMessage, AiToolSpec } from "../domain/ai-provider";
import type { AiTool, AiToolContext } from "../domain/tool";
import { AiGatewayService } from "./ai-gateway.service";

// ai-spec.md §6: "max tool-call depth 6." Each iteration is one real,
// separately-metered model invocation (NFR-27) — this is the hard cost/
// safety bound the spec asks for; true cycle detection (same tool+input
// repeated) would be a refinement on top, not implemented since the depth
// cap already bounds worst-case cost and loop length (flagged follow-up).
const MAX_TOOL_CALL_DEPTH = 6;

export interface ExecutedToolCall {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
}

export interface ToolRunResult {
  content: string;
  toolCalls: ExecutedToolCall[];
  aiRunIds: string[];
  hitMaxDepth: boolean;
}

// ai-spec.md §6's generic tool-calling loop — a platform AI Gateway
// capability (not project-assistant-specific), same "rails" role as
// AiGatewayService itself. Every provider round-trip goes through
// AiGatewayService.run() so budget enforcement and per-run metering apply
// to each turn, not just the first.
//
// SECURITY (ai-spec §6: "tool runs under the user's permission set ...
// never elevated"): this class trusts its caller completely — `tools`
// must already be filtered down to exactly what the calling actor is
// permitted to use. The model is never offered a tool the caller
// couldn't invoke directly.
@Injectable()
export class ToolRunnerService {
  constructor(private readonly aiGateway: AiGatewayService) {}

  async run(input: {
    tenantId: string;
    actorId: string | null;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    tools: AiTool[];
    toolContext: AiToolContext;
    purpose: string;
    promptTemplateId?: string;
    maxTokens: number;
  }): Promise<ToolRunResult> {
    const toolsByName = new Map(input.tools.map((t) => [t.name, t]));
    const toolSpecs: AiToolSpec[] = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      // zod-to-json-schema's own ZodSchema type comes from the "zod/v3"
      // compat subpath, not this codebase's "zod" import — TS tries (and
      // fails) to structurally reconcile the two, "excessively deep"
      // instantiation. `any` here is a narrow bridge across that type-
      // identity mismatch, not a correctness shortcut in our own code.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: zodToJsonSchema(t.inputSchema as any, { target: "jsonSchema7", $refStrategy: "none" }) as Record<
        string,
        unknown
      >,
    }));

    const messages: AiMessage[] = [{ role: "user", content: input.userPrompt }];
    const executedToolCalls: ExecutedToolCall[] = [];
    const aiRunIds: string[] = [];

    for (let depth = 0; depth < MAX_TOOL_CALL_DEPTH; depth++) {
      const result = await this.aiGateway.run(input.tenantId, input.actorId, {
        purpose: input.purpose,
        ...(input.promptTemplateId && { promptTemplateId: input.promptTemplateId }),
        model: input.model,
        systemPrompt: input.systemPrompt,
        messages,
        tools: toolSpecs,
        maxTokens: input.maxTokens,
      });
      aiRunIds.push(result.aiRunId);

      if (result.toolCalls.length === 0) {
        return { content: result.content ?? "", toolCalls: executedToolCalls, aiRunIds, hitMaxDepth: false };
      }

      messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const tool = toolsByName.get(call.name);
        if (!tool) {
          messages.push({ role: "tool_result", toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true });
          continue;
        }
        try {
          const parsedInput = tool.inputSchema.parse(call.input);
          const output = await tool.execute(input.toolContext, parsedInput);
          executedToolCalls.push({ id: call.id, name: call.name, input: parsedInput, output });
          messages.push({ role: "tool_result", toolCallId: call.id, content: JSON.stringify(output) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          messages.push({ role: "tool_result", toolCallId: call.id, content: message, isError: true });
        }
      }
    }

    return { content: "", toolCalls: executedToolCalls, aiRunIds, hitMaxDepth: true };
  }
}
