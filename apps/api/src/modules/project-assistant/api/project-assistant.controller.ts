import { Body, Controller, Param, Post, Req, Res } from "@nestjs/common";
import { openConversationSchema, postMessageSchema } from "@constructionos/schemas";
import type { FastifyReply } from "fastify";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ProjectAssistantService } from "../application/project-assistant.service";

// api.md §13: POST /ai/conversations, POST /ai/conversations/{id}/messages.
@Controller("ai/conversations")
export class ProjectAssistantController {
  constructor(private readonly assistant: ProjectAssistantService) {}

  @Post()
  @RequirePermission("ai.conversation.create")
  open(
    @Body(new ZodValidationPipe(openConversationSchema)) body: z.infer<typeof openConversationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.assistant.openConversation(req.auth!.tenantId, req.auth!.sub, body);
  }

  // api.md §13: "User message -> SSE stream response (tokens, tool-call
  // events, final message with sources[], confidence, ai_run_id)." This
  // codebase's AnthropicProvider wraps the SDK's non-streaming
  // messages.create call (ai/infrastructure/anthropic-provider.ts), so
  // there's no token-level delta stream to relay yet (flagged follow-up —
  // would mean switching that provider to the SDK's .stream() API); this
  // emits real `tool_call` events as the tool-calling loop actually
  // executes them, then one `message` event carrying the complete final
  // answer — chunked at tool-call/final-message granularity rather than
  // per-token.
  @Post(":id/messages")
  @RequirePermission("ai.conversation.create")
  async postMessage(
    @Param("id") conversationId: string,
    @Body(new ZodValidationPipe(postMessageSchema)) body: z.infer<typeof postMessageSchema>,
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Existence-checked before any bytes go out — a missing conversation
    // is a normal 404 JSON error, not an in-stream error event.
    await this.assistant.getConversation(req.auth!.tenantId, req.auth!.sub, conversationId);

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const writeEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const message = await this.assistant.postMessage(
        req.auth!.tenantId,
        req.auth!.sub,
        conversationId,
        body.content,
        (name) => writeEvent("tool_call", { name }),
      );
      writeEvent("message", message);
    } catch (err) {
      writeEvent("error", { message: err instanceof Error ? err.message : "an unexpected error occurred" });
    } finally {
      reply.raw.end();
    }
  }
}
