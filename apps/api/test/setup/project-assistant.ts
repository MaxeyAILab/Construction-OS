import type Redis from "ioredis";
import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient } from "../../src/infrastructure/redis/client";
import { DailyReportsService } from "../../src/modules/daily-reports/application/daily-reports.service";
import { DashboardsService } from "../../src/modules/dashboards/application/dashboards.service";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import { ToolRunnerService } from "../../src/modules/ai/application/tool-runner.service";
import type { AiCompletionRequest, AiCompletionResult, AiProvider, AiToolCall } from "../../src/modules/ai/domain/ai-provider";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { PhotosService } from "../../src/modules/photos/application/photos.service";
import { ProjectAssistantService } from "../../src/modules/project-assistant/application/project-assistant.service";
import { RagIndexingService } from "../../src/modules/rag/application/rag-indexing.service";
import { RagSearchService } from "../../src/modules/rag/application/rag-search.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { RfisService } from "../../src/modules/rfis/application/rfis.service";
import { TasksService } from "../../src/modules/tasks/application/tasks.service";
import { buildTestFileServices } from "./files";
import { FakeEmbeddingProvider } from "./rag";

// Deterministic tool-calling test double — same "real double, not a
// network client" role as FakeAiProvider/FakeEmbeddingProvider elsewhere
// in this suite. Stateless: decides which tool(s) to call purely from
// the request's own messages/tools (keyword-matched against the user's
// text), then on the next turn (once tool_result messages are present)
// synthesizes a final answer that echoes back what the tools returned —
// so tests can assert grounding actually happened, not just that some
// text came back.
export class ScriptedToolCallingProvider implements AiProvider {
  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const messages = request.messages ?? [];
    const last = messages.at(-1);

    if (last?.role === "tool_result") {
      const toolResultText = messages
        .filter((m): m is Extract<typeof m, { role: "tool_result" }> => m.role === "tool_result")
        .map((m) => m.content)
        .join("\n");
      return { content: `Based on what I found: ${toolResultText}`, toolCalls: [], inputTokens: 10, outputTokens: 10 };
    }

    const userMessage = messages.find((m) => m.role === "user");
    const text = userMessage && "content" in userMessage ? userMessage.content : "";
    const available = new Set((request.tools ?? []).map((t) => t.name));
    const toolCalls: AiToolCall[] = [];

    if (available.has("search_project_records") && /search|find|about|leak/i.test(text)) {
      toolCalls.push({ id: "call-search", name: "search_project_records", input: { query: text } });
    }
    if (available.has("get_project_summary") && /summary|status|health|margin/i.test(text)) {
      toolCalls.push({ id: "call-summary", name: "get_project_summary", input: {} });
    }
    if (available.has("list_overdue_tasks") && /overdue/i.test(text)) {
      toolCalls.push({ id: "call-overdue", name: "list_overdue_tasks", input: {} });
    }
    if (available.has("list_open_rfis") && /rfi/i.test(text)) {
      toolCalls.push({ id: "call-rfis", name: "list_open_rfis", input: {} });
    }
    if (available.has("suggest_tasks") && /suggest|draft|action item|notes/i.test(text)) {
      toolCalls.push({
        id: "call-suggest",
        name: "suggest_tasks",
        input: { tasks: [{ title: "Follow up on discussion", description: text.slice(0, 80) }] },
      });
    }

    if (toolCalls.length === 0) {
      return { content: "I don't have a specific tool for that, but I'm happy to help.", toolCalls: [], inputTokens: 5, outputTokens: 5 };
    }
    return { content: null, toolCalls, inputTokens: 10, outputTokens: 10 };
  }
}

export function buildTestProjectAssistantServices(db: Database): {
  projectAssistantService: ProjectAssistantService;
  tasksService: TasksService;
  rfisService: RfisService;
  ragIndexingService: RagIndexingService;
  dashboardsService: DashboardsService;
  cacheRedis: Redis;
} {
  const outbox = new OutboxService();
  const tasksService = new TasksService(db, outbox);
  const rfisService = new RfisService(db, outbox);
  const dailyReportsService = new DailyReportsService(db, outbox);
  const dashboardsService = new DashboardsService(db);
  const { fileUploadService } = buildTestFileServices(db);
  const photosService = new PhotosService(db, outbox, fileUploadService);

  const embeddingProvider = new FakeEmbeddingProvider();
  const ragIndexingService = new RagIndexingService(
    db,
    embeddingProvider,
    tasksService,
    rfisService,
    dailyReportsService,
    photosService,
  );

  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(cacheRedis);
  const permissions = new PermissionResolverService(db, cache);
  const ragSearchService = new RagSearchService(db, embeddingProvider, permissions);

  const provider = new ScriptedToolCallingProvider();
  const aiGatewayService = new AiGatewayService(db, provider);
  const toolRunnerService = new ToolRunnerService(aiGatewayService);

  const projectAssistantService = new ProjectAssistantService(
    db,
    toolRunnerService,
    permissions,
    ragSearchService,
    dashboardsService,
    tasksService,
    rfisService,
  );

  return { projectAssistantService, tasksService, rfisService, ragIndexingService, dashboardsService, cacheRedis };
}
