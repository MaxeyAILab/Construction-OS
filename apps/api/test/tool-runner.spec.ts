import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiGatewayService } from "../src/modules/ai/application/ai-gateway.service";
import { ToolRunnerService } from "../src/modules/ai/application/tool-runner.service";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../src/modules/ai/domain/ai-provider";
import type { AiTool } from "../src/modules/ai/domain/tool";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";

// A provider that never stops calling tools — exercises the loop guard
// (ai-spec.md §6: "max tool-call depth 6") in isolation from any real
// tool/domain logic.
class AlwaysCallsToolProvider implements AiProvider {
  callCount = 0;
  async complete(_request: AiCompletionRequest): Promise<AiCompletionResult> {
    this.callCount += 1;
    return { content: null, toolCalls: [{ id: `call-${this.callCount}`, name: "echo", input: { value: this.callCount } }], inputTokens: 1, outputTokens: 1 };
  }
}

const echoTool: AiTool<{ value: number }> = {
  name: "echo",
  description: "echoes its input",
  inputSchema: z.object({ value: z.number() }),
  permissionKey: "test.echo.use",
  consequenceClass: "read",
  module: "test",
  async execute(_ctx, input) {
    return input;
  },
};

describe("ToolRunnerService (ai-spec.md §6 tool-calling loop)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpTenant(): Promise<string> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `tool-runner-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Tool Runner ${suffix}`,
    });
    return signUp.companyId;
  }

  it("stops after MAX_TOOL_CALL_DEPTH iterations when the model never produces a final answer", async () => {
    const tenantId = await signUpTenant();
    const provider = new AlwaysCallsToolProvider();
    const gateway = new AiGatewayService(db, provider);
    const runner = new ToolRunnerService(gateway);

    const result = await runner.run({
      tenantId,
      actorId: null,
      model: "claude-sonnet-5",
      systemPrompt: "test",
      userPrompt: "loop forever",
      tools: [echoTool],
      toolContext: { tenantId, actorId: "system" },
      purpose: "test.tool_runner",
      maxTokens: 256,
    });

    expect(result.hitMaxDepth).toBe(true);
    expect(provider.callCount).toBe(6);
    expect(result.toolCalls).toHaveLength(6);
  });

  it("stops as soon as the model returns a final answer with no tool calls", async () => {
    const tenantId = await signUpTenant();
    let callCount = 0;
    const provider: AiProvider = {
      async complete() {
        callCount += 1;
        if (callCount === 1) {
          return { content: null, toolCalls: [{ id: "call-1", name: "echo", input: { value: 1 } }], inputTokens: 1, outputTokens: 1 };
        }
        return { content: "done", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    };
    const gateway = new AiGatewayService(db, provider);
    const runner = new ToolRunnerService(gateway);

    const result = await runner.run({
      tenantId,
      actorId: null,
      model: "claude-sonnet-5",
      systemPrompt: "test",
      userPrompt: "one tool call then answer",
      tools: [echoTool],
      toolContext: { tenantId, actorId: "system" },
      purpose: "test.tool_runner",
      maxTokens: 256,
    });

    expect(result.hitMaxDepth).toBe(false);
    expect(result.content).toBe("done");
    expect(result.toolCalls).toHaveLength(1);
    expect(callCount).toBe(2);
  });
});
