import { Inject, Injectable } from "@nestjs/common";
import type { AssistantMessage, AssistantSource, OpenConversationInput, SearchResult, SuggestedTask } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { aiConversations, aiMessages } from "../../../infrastructure/db/schema";
import { ToolRunnerService } from "../../ai";
import { DashboardsService } from "../../dashboards";
import { RagSearchService } from "../../rag";
import { PermissionResolverService } from "../../rbac";
import { RfisService } from "../../rfis";
import { TasksService } from "../../tasks";
import { buildExecutiveAssistantTools, buildProjectAssistantTools } from "./build-tools";
import { ConversationNotFoundError } from "../domain/errors";

// ai-spec.md §7.2 doesn't name a specific model — same default as the AI
// Gateway's own soft-degrade target family; a real prompt-template
// registry (ai-spec §5, packages/ai/prompts/) doesn't exist yet in this
// codebase (no consuming feature needed one until now) — promptTemplateId
// is left undefined below, flagged as a follow-up once that registry
// lands, same as ai-runs.prompt_template_id's existing nullable comment.
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048;

const PROJECT_SYSTEM_PROMPT = [
  "You are the ConstructionOS Project Assistant embedded in a project command center.",
  "Answer only from information returned by your tools — never invent project data, numbers, or names.",
  "Use search_project_records for open-ended questions, get_project_summary for status/health/margin, ",
  "list_overdue_tasks and list_open_rfis for risk questions, and suggest_tasks when the user pastes notes ",
  "to turn into action items or asks for next steps. Cite what you found; if your tools return nothing ",
  "relevant, say so plainly instead of guessing.",
].join("");

// ai-spec.md §7.1 (Executive Assistant, Phase 3). Deliberately narrower
// than §7.1's full capability list: anomaly surfacing, what-if sketches,
// and board-pack drafting have no api.md endpoint of their own (only the
// generic POST /ai/conversations contract this row reuses) — flagged
// follow-ups, not silently built here. Proactive briefings are likewise
// out of scope this pass — no scheduled-delivery endpoint exists in
// api.md, only the passive Q&A contract.
const EXECUTIVE_SYSTEM_PROMPT = [
  "You are the ConstructionOS Executive Assistant, answering company-wide questions for an owner or executive.",
  "Answer only from information returned by your tools — never invent company data, numbers, or names.",
  "Use search_company_records for open-ended questions across all projects, and get_company_summary for ",
  "portfolio-wide status, profitability, and risk questions. Cite what you found; if your tools return nothing ",
  "relevant, say so plainly instead of guessing.",
].join("");

// ai-spec.md §8's UX confidence buckets, reused here as the escalation
// thresholds (§9 row 1: "confidence < task threshold").
const HEDGE_THRESHOLD = 0.6;
const PLAIN_THRESHOLD = 0.85;
const GROUNDING_TOOLS = new Set([
  "search_project_records",
  "get_project_summary",
  "list_overdue_tasks",
  "list_open_rfis",
  "search_company_records",
  "get_company_summary",
]);

@Injectable()
export class ProjectAssistantService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly toolRunner: ToolRunnerService,
    private readonly permissions: PermissionResolverService,
    private readonly ragSearch: RagSearchService,
    private readonly dashboards: DashboardsService,
    private readonly tasks: TasksService,
    private readonly rfis: RfisService,
  ) {}

  // api.md §13: POST /ai/conversations. Project threads are existence-
  // checked via DashboardsService.getProject (throws ProjectNotFoundError
  // if missing/soft-deleted, reused rather than duplicating that query);
  // company threads (ai-spec §7.1) have no separate entity to check — the
  // tenant itself is the implicit scope, so entityId stays null (same
  // nullable column the schema already anticipated).
  async openConversation(tenantId: string, userId: string, input: OpenConversationInput) {
    if (input.entityRef.type === "project") {
      await this.dashboards.getProject(tenantId, input.entityRef.id);
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(aiConversations)
        .values({
          tenantId,
          userId,
          module: input.module,
          entityType: input.entityRef.type,
          entityId: input.entityRef.type === "project" ? input.entityRef.id : null,
        })
        .returning();
      return row!;
    });
  }

  // The controller calls this before opening its SSE stream — a missing
  // conversation should be a normal 404 JSON error, not an error event
  // inside an already-200'd event stream (which is the only response
  // shape left once SSE headers are committed).
  //
  // database.md §19: "threads per user" — scoped to the user who opened
  // them, not shared tenant-wide; a caller asking for someone else's
  // conversation gets the same 404 as a nonexistent one (never a 403
  // that would confirm the conversation exists at all).
  async getConversation(tenantId: string, userId: string, conversationId: string) {
    const conversation = await withTenant(this.db, tenantId, (tx) =>
      tx.query.aiConversations.findFirst({ where: eq(aiConversations.id, conversationId) }),
    );
    if (!conversation || conversation.userId !== userId) throw new ConversationNotFoundError();
    return conversation;
  }

  // api.md §13: POST /ai/conversations/{id}/messages. `onToolCall` fires
  // synchronously as each tool executes, mid-loop — the controller uses
  // it to stream real tool_call SSE events before the final message
  // arrives (see rag-search.controller.ts-style permission-filtered
  // reuse: the model is only ever offered tools this actor already holds
  // the permission for — ai-spec §6, "never elevated").
  async postMessage(
    tenantId: string,
    userId: string,
    conversationId: string,
    content: string,
    onToolCall?: (name: string) => void,
  ): Promise<AssistantMessage> {
    const conversation = await this.getConversation(tenantId, userId, conversationId);

    await withTenant(this.db, tenantId, (tx) =>
      tx.insert(aiMessages).values({ tenantId, conversationId, role: "user", content }),
    );

    const isCompanyScoped = conversation.entityType === "company";
    const allTools = isCompanyScoped
      ? buildExecutiveAssistantTools({ ragSearch: this.ragSearch, dashboards: this.dashboards })
      : buildProjectAssistantTools(
          { ragSearch: this.ragSearch, dashboards: this.dashboards, tasks: this.tasks, rfis: this.rfis },
          conversation.entityId!,
        );

    const grantedPermissions = new Set(await this.permissions.resolve(tenantId, userId));
    const tools = allTools.filter((t) => grantedPermissions.has(t.permissionKey));

    const result = await this.toolRunner.run({
      tenantId,
      actorId: userId,
      model: MODEL,
      systemPrompt: isCompanyScoped ? EXECUTIVE_SYSTEM_PROMPT : PROJECT_SYSTEM_PROMPT,
      userPrompt: content,
      tools,
      toolContext: { tenantId, actorId: userId },
      purpose: isCompanyScoped ? "executive_assistant.message" : "project_assistant.message",
      maxTokens: MAX_TOKENS,
    });
    for (const call of result.toolCalls) onToolCall?.(call.name);

    const sources = extractSources(result.toolCalls);
    const suggestedTasks = extractSuggestedTasks(result.toolCalls);
    const groundingCount = result.toolCalls.filter((c) => GROUNDING_TOOLS.has(c.name) && hasContent(c.output)).length;

    const { text, confidence, escalated } = composeAnswer(result, groundingCount);

    const [assistantRow] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .insert(aiMessages)
        .values({
          tenantId,
          conversationId,
          role: "assistant",
          content: text,
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : null,
        })
        .returning(),
    );

    return {
      id: assistantRow!.id,
      role: "assistant",
      content: text,
      sources,
      ...(suggestedTasks.length > 0 && { suggestedTasks }),
      confidence,
      escalated,
      aiRunId: result.aiRunIds.at(-1) ?? null,
      createdAt: assistantRow!.createdAt.toISOString(),
    };
  }
}

function hasContent(output: unknown): boolean {
  if (Array.isArray(output)) return output.length > 0;
  if (output && typeof output === "object") return Object.keys(output).length > 0;
  return Boolean(output);
}

function extractSources(toolCalls: { name: string; output: unknown }[]): AssistantSource[] {
  const sources: AssistantSource[] = [];
  for (const call of toolCalls) {
    if ((call.name !== "search_project_records" && call.name !== "search_company_records") || !Array.isArray(call.output)) continue;
    for (const r of call.output as SearchResult[]) {
      sources.push({ entityType: r.entityType, entityId: r.entityId, title: r.title });
    }
  }
  return sources;
}

function extractSuggestedTasks(toolCalls: { name: string; output: unknown }[]): SuggestedTask[] {
  const suggested: SuggestedTask[] = [];
  for (const call of toolCalls) {
    if (call.name !== "suggest_tasks" || !call.output || typeof call.output !== "object") continue;
    const output = call.output as { tasks?: SuggestedTask[] };
    if (Array.isArray(output.tasks)) suggested.push(...output.tasks);
  }
  return suggested;
}

// ai-spec.md §8's confidence buckets (plain/hedge/escalate) and §9's two
// mechanically-checkable escalation rows: "retrieval empty" (a
// search_project_records call came back with nothing, and no other
// grounding tool filled in) and "confidence < task threshold". The
// remaining §9 rows (safety-critical force-escalation, financial-
// threshold maker/checker routing, user-frustration signals) need domain
// classifiers this pass doesn't build — flagged, not silently dropped.
// The groundedness checker (§10.1, "a small model verifies claim-to-
// source entailment") and the calibrated-classifier confidence scoring
// (§8) are likewise not implemented; this heuristic (more grounding tool
// calls with real output -> higher confidence) is a documented stand-in.
function composeAnswer(
  result: { content: string; hitMaxDepth: boolean },
  groundingCount: number,
): { text: string; confidence: number; escalated: boolean } {
  if (result.hitMaxDepth) {
    return {
      text: "I wasn't able to finish gathering information for this within my tool-call budget. Please try a narrower question, or open the relevant records directly.",
      confidence: 0,
      escalated: true,
    };
  }

  const confidence = groundingCount === 0 ? 0.4 : Math.min(0.95, 0.55 + 0.15 * groundingCount);

  if (confidence < HEDGE_THRESHOLD) {
    return {
      text: `I don't have grounds to fully answer that yet. Here's what I found: ${result.content || "nothing directly relevant."}`,
      confidence,
      escalated: true,
    };
  }
  if (confidence < PLAIN_THRESHOLD) {
    return { text: `${result.content} (I'd recommend verifying this directly.)`, confidence, escalated: false };
  }
  return { text: result.content, confidence, escalated: false };
}
