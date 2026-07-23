import { Inject, Injectable } from "@nestjs/common";
import type { AiRunRequest, ListAiRunsQuery } from "@constructionos/schemas";
import { and, eq, gte, lt, lte, or, sum } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { aiBudgets, aiRuns } from "../../../infrastructure/db/schema";
import { AI_PROVIDER, type AiProvider } from "../domain/ai-provider";
import { AiBudgetExceededError } from "../domain/errors";
import { computeCostUsd, DEGRADED_MODEL } from "../domain/model-pricing";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// ai-spec.md §2's default budget for a tenant with no ai_budgets row yet —
// the same "sensible default, no provisioning required" precedent as
// notification_preferences defaulting when a row is absent.
const DEFAULT_MONTHLY_LIMIT_USD = 50;
const DEFAULT_SOFT_LIMIT_RATIO = 0.8;

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// architecture.md §7 / ai-spec.md §2: "single entry point for all model
// calls ... per-tenant metering and budgets ... full audit of every AI
// action." No product feature calls this yet (Project Assistant, RAG,
// etc. are later Phase 1D rows) — this is the infrastructure those
// features will inject, same "build the rails before the first train"
// precedent as OutboxService predating any specific event producer.
@Injectable()
export class AiGatewayService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  // ai-spec.md §2: "soft limit = degrade (cache-only, smaller models,
  // batch deferral), hard limit = assistant explains and offers a
  // top-up." Budget check + degrade decision happen against the DB
  // first; the provider call itself runs outside any transaction (it's a
  // slow network call — never hold a Postgres connection across it, same
  // "resolve local data, call external systems independently" precedent
  // as SyncWorkingSetService's cross-module calls); the resulting run is
  // recorded in a second, separate transaction.
  async run(tenantId: string, actorId: string | null, request: AiRunRequest) {
    const { currentMonthUsage, hardLimit, softLimit } = await this.getBudgetStatus(tenantId);

    if (currentMonthUsage >= hardLimit) {
      throw new AiBudgetExceededError();
    }

    const degraded = currentMonthUsage >= softLimit;
    const model = degraded ? DEGRADED_MODEL : request.model;

    const startedAt = Date.now();
    let result: { content: string; inputTokens: number; outputTokens: number };
    try {
      result = await this.provider.complete({
        model,
        ...(request.systemPrompt && { systemPrompt: request.systemPrompt }),
        userPrompt: request.userPrompt,
        maxTokens: request.maxTokens,
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const aiRunId = await this.recordRun(tenantId, actorId, request, model, 0, 0, latencyMs, "error");
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { aiRunId });
    }
    const latencyMs = Date.now() - startedAt;

    const aiRunId = await this.recordRun(
      tenantId,
      actorId,
      request,
      model,
      result.inputTokens,
      result.outputTokens,
      latencyMs,
      "shown",
    );

    return {
      aiRunId,
      content: result.content,
      model,
      degraded,
      costUsd: computeCostUsd(model, result.inputTokens, result.outputTokens),
    };
  }

  private async recordRun(
    tenantId: string,
    actorId: string | null,
    request: AiRunRequest,
    model: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    outcome: "shown" | "error",
  ): Promise<string> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(aiRuns)
        .values({
          tenantId,
          actorId,
          purpose: request.purpose,
          promptTemplateId: request.promptTemplateId,
          model,
          inputTokens,
          outputTokens,
          costUsd: computeCostUsd(model, inputTokens, outputTokens),
          latencyMs,
          outcome,
        })
        .returning();
      return row!.id;
    });
  }

  private async getBudgetStatus(
    tenantId: string,
  ): Promise<{ currentMonthUsage: number; hardLimit: number; softLimit: number }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const budget = await tx.query.aiBudgets.findFirst({ where: eq(aiBudgets.tenantId, tenantId) });
      const hardLimit = budget ? Number(budget.monthlyLimitUsd) : DEFAULT_MONTHLY_LIMIT_USD;
      const softLimitRatio = budget ? Number(budget.softLimitRatio) : DEFAULT_SOFT_LIMIT_RATIO;

      const [row] = await tx
        .select({ total: sum(aiRuns.costUsd) })
        .from(aiRuns)
        .where(and(eq(aiRuns.tenantId, tenantId), gte(aiRuns.createdAt, startOfCurrentMonth())));

      return {
        currentMonthUsage: Number(row?.total ?? 0),
        hardLimit,
        softLimit: hardLimit * softLimitRatio,
      };
    });
  }

  // ai-spec.md §12: outcome transitions as a product surface observes
  // what the user did (shown -> accepted/rejected/auto_applied/
  // escalated) — no consuming feature drives this yet, but the RLS
  // migration's trigger already only permits this one column to change.
  async updateOutcome(tenantId: string, aiRunId: string, outcome: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) => tx.update(aiRuns).set({ outcome }).where(eq(aiRuns.id, aiRunId)));
  }

  // api.md §13: `GET /ai/runs` — "Tenant AI audit/usage (filter[purpose],
  // cost aggregates — NFR-27)". totalCostUsd sums the *whole* filtered
  // set (not just the current page) via a separate aggregate query using
  // the same filter conditions minus the cursor.
  async listRuns(tenantId: string, query: ListAiRunsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const baseConditions = [eq(aiRuns.tenantId, tenantId)];
      if (query.purpose) baseConditions.push(eq(aiRuns.purpose, query.purpose));
      if (query.outcome) baseConditions.push(eq(aiRuns.outcome, query.outcome));
      if (query.createdFrom) baseConditions.push(gte(aiRuns.createdAt, new Date(query.createdFrom)));
      if (query.createdTo) baseConditions.push(lte(aiRuns.createdAt, new Date(query.createdTo)));

      const pageConditions = [...baseConditions];
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        pageConditions.push(
          or(
            lt(aiRuns.createdAt, new Date(c.createdAt)),
            and(eq(aiRuns.createdAt, new Date(c.createdAt)), lt(aiRuns.id, c.id)),
          )!,
        );
      }

      const [rows, [aggregate]] = await Promise.all([
        tx.query.aiRuns.findMany({
          where: and(...pageConditions),
          orderBy: (r, { desc }) => [desc(r.createdAt), desc(r.id)],
          limit: query.limit + 1,
        }),
        tx.select({ total: sum(aiRuns.costUsd) }).from(aiRuns).where(and(...baseConditions)),
      ]);

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return {
        data: page,
        meta: { cursor: nextCursor, hasMore, totalCostUsd: aggregate?.total ?? "0.000000" },
      };
    });
  }
}
