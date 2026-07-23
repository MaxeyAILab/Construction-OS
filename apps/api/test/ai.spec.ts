import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { aiBudgets, aiRuns } from "../src/infrastructure/db/schema";
import { AiBudgetExceededError } from "../src/modules/ai/domain/errors";
import { buildTestAuthService } from "./setup/auth";
import { buildTestAiServices } from "./setup/ai";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";

describe("AI Gateway v1: metering, budgets, audit", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { aiGatewayService, provider } = buildTestAiServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `ai-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `AI ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    return { tenantId: signUp.companyId, ownerId };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function countRuns(tenantId: string): Promise<number> {
    const rows = await withTenant(db, tenantId, (tx) => tx.query.aiRuns.findMany({ where: eq(aiRuns.tenantId, tenantId) }));
    return rows.length;
  }

  it("records a run: meters tokens/cost and writes an ai_runs row with outcome='shown'", async () => {
    const { tenantId, ownerId } = await signUpCompany("meter");
    provider.setResponse({ content: "hello from claude", inputTokens: 1000, outputTokens: 500 });

    const result = await aiGatewayService.run(tenantId, ownerId, {
      purpose: "test.purpose",
      model: "claude-sonnet-5",
      userPrompt: "hi",
      maxTokens: 256,
    });

    expect(result.content).toBe("hello from claude");
    expect(result.degraded).toBe(false);
    // claude-sonnet-5: $3/M input, $15/M output -> 1000*3/1e6 + 500*15/1e6 = 0.003 + 0.0075 = 0.0105
    expect(result.costUsd).toBe("0.010500");

    const [row] = await withTenant(db, tenantId, (tx) => tx.query.aiRuns.findMany({ where: eq(aiRuns.tenantId, tenantId) }));
    expect(row).toBeDefined();
    expect(row!.id).toBe(result.aiRunId);
    expect(row!.purpose).toBe("test.purpose");
    expect(row!.model).toBe("claude-sonnet-5");
    expect(row!.inputTokens).toBe(1000);
    expect(row!.outputTokens).toBe(500);
    expect(row!.costUsd).toBe("0.010500");
    expect(row!.outcome).toBe("shown");
    expect(row!.actorId).toBe(ownerId);
  });

  it("records outcome='error' and rethrows when the provider call itself fails", async () => {
    const { tenantId, ownerId } = await signUpCompany("provider-error");
    provider.setShouldThrow(true);

    await expect(
      aiGatewayService.run(tenantId, ownerId, {
        purpose: "test.purpose",
        model: "claude-sonnet-5",
        userPrompt: "hi",
        maxTokens: 256,
      }),
    ).rejects.toThrow(/fake provider failure/);
    provider.setShouldThrow(false);

    const [row] = await withTenant(db, tenantId, (tx) => tx.query.aiRuns.findMany({ where: eq(aiRuns.tenantId, tenantId) }));
    expect(row).toBeDefined();
    expect(row!.outcome).toBe("error");
    expect(row!.inputTokens).toBe(0);
    expect(row!.outputTokens).toBe(0);
  });

  it("degrades to the fallback model once usage crosses the soft budget threshold", async () => {
    const { tenantId, ownerId } = await signUpCompany("soft-limit");
    await withTenant(db, tenantId, (tx) =>
      tx.insert(aiBudgets).values({ tenantId, monthlyLimitUsd: "1.00", softLimitRatio: "0.50" }),
    );
    // Push usage to 0.60 (above the 0.50 soft threshold, below the 1.00 hard limit).
    await withTenant(db, tenantId, (tx) =>
      tx.insert(aiRuns).values({
        tenantId,
        purpose: "seed",
        model: "claude-sonnet-5",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: "0.600000",
        latencyMs: 1,
      }),
    );

    provider.setResponse({ content: "degraded reply", inputTokens: 10, outputTokens: 10 });
    const result = await aiGatewayService.run(tenantId, ownerId, {
      purpose: "test.purpose",
      model: "claude-opus-4-8",
      userPrompt: "hi",
      maxTokens: 256,
    });

    expect(result.degraded).toBe(true);
    expect(result.model).toBe("claude-haiku-4-5-20251001");
    expect(provider.lastRequest?.model).toBe("claude-haiku-4-5-20251001");
  });

  it("blocks the call entirely once usage reaches the hard limit, without recording a new run", async () => {
    const { tenantId, ownerId } = await signUpCompany("hard-limit");
    await withTenant(db, tenantId, (tx) => tx.insert(aiBudgets).values({ tenantId, monthlyLimitUsd: "1.00" }));
    await withTenant(db, tenantId, (tx) =>
      tx.insert(aiRuns).values({
        tenantId,
        purpose: "seed",
        model: "claude-sonnet-5",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: "1.000000",
        latencyMs: 1,
      }),
    );
    const before = await countRuns(tenantId);

    await expect(
      aiGatewayService.run(tenantId, ownerId, {
        purpose: "test.purpose",
        model: "claude-sonnet-5",
        userPrompt: "hi",
        maxTokens: 256,
      }),
    ).rejects.toThrow(AiBudgetExceededError);

    expect(await countRuns(tenantId)).toBe(before); // no new row for a blocked (never-invoked) attempt
  });

  it("updateOutcome transitions outcome (shown -> accepted) as the only mutable field", async () => {
    const { tenantId, ownerId } = await signUpCompany("outcome");
    const result = await aiGatewayService.run(tenantId, ownerId, {
      purpose: "test.purpose",
      model: "claude-sonnet-5",
      userPrompt: "hi",
      maxTokens: 256,
    });

    await aiGatewayService.updateOutcome(tenantId, result.aiRunId, "accepted");

    const [row] = await withTenant(db, tenantId, (tx) => tx.query.aiRuns.findMany({ where: eq(aiRuns.tenantId, tenantId) }));
    expect(row!.outcome).toBe("accepted");
  });

  it("is immutable except outcome: UPDATE of any other column and DELETE are both rejected", async () => {
    const { tenantId, ownerId } = await signUpCompany("immutable");
    const result = await aiGatewayService.run(tenantId, ownerId, {
      purpose: "test.purpose",
      model: "claude-sonnet-5",
      userPrompt: "hi",
      maxTokens: 256,
    });

    await expect(
      withTenant(db, tenantId, (tx) =>
        tx.update(aiRuns).set({ model: "tampered" }).where(eq(aiRuns.id, result.aiRunId)),
      ),
    ).rejects.toThrow(/immutable/);

    await expect(
      withTenant(db, tenantId, (tx) => tx.delete(aiRuns).where(eq(aiRuns.id, result.aiRunId))),
    ).rejects.toThrow(/append-only/);
  });

  it("listRuns: filters by purpose and returns a cost aggregate over the whole filtered set", async () => {
    const { tenantId, ownerId } = await signUpCompany("list");
    provider.setResponse({ content: "a", inputTokens: 1_000_000, outputTokens: 0 }); // $3.00 at claude-sonnet-5 rates
    await aiGatewayService.run(tenantId, ownerId, {
      purpose: "purpose.a",
      model: "claude-sonnet-5",
      userPrompt: "hi",
      maxTokens: 256,
    });
    await aiGatewayService.run(tenantId, ownerId, {
      purpose: "purpose.b",
      model: "claude-sonnet-5",
      userPrompt: "hi",
      maxTokens: 256,
    });

    const page = await aiGatewayService.listRuns(tenantId, { purpose: "purpose.a", limit: 20 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.purpose).toBe("purpose.a");
    expect(page.meta.totalCostUsd).toBe("3.000000");
  });

  it("RLS: a tenant only sees its own ai_runs", async () => {
    const a = await signUpCompany("rls-a");
    const b = await signUpCompany("rls-b");
    await aiGatewayService.run(a.tenantId, a.ownerId, {
      purpose: "test.purpose",
      model: "claude-sonnet-5",
      userPrompt: "hi",
      maxTokens: 256,
    });

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.aiRuns.findMany());
    expect(rowsB).toHaveLength(0);

    const rowsA = await withTenant(db, a.tenantId, (tx) => tx.query.aiRuns.findMany());
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });
});
