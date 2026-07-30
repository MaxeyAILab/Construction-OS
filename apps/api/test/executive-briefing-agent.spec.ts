import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox, roles, rolePermissions } from "../src/infrastructure/db/schema";
import { AiGatewayService } from "../src/modules/ai/application/ai-gateway.service";
import { CashflowForecastService } from "../src/modules/finance-alerts/application/cashflow-forecast.service";
import { FinanceAlertsQueryService } from "../src/modules/finance-alerts/application/finance-alerts-query.service";
import { buildTestAgentIdentitiesService, buildTestExecutiveBriefingAgentRunner } from "./setup/agents";
import { buildTestAiServices, FakeAiProvider } from "./setup/ai";
import { buildTestAuthService } from "./setup/auth";
import { buildTestCrmServices } from "./setup/crm";
import { buildTestExecutiveBriefingService } from "./setup/dashboards";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSchedulingServices } from "./setup/scheduling";

// api.md §15.6 "Executive Briefing Agent" (ai-spec.md §7.1). The weekly
// tick (ExecutiveBriefingAgentRunnerService.runTick, tested directly here
// rather than through ExecutiveBriefingAgentWorker's BullMQ scheduling)
// reuses ExecutiveBriefingService.generate unchanged under a declared
// agent's own actor. These tests cover the new composition: attribution,
// the notify_user_id = agent creator convention, and kill-switch
// integration — not ExecutiveBriefingService's own aggregation math (see
// executive-briefing.spec.ts for that).
describe("Executive Briefing Agent: weekly tick", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { opportunitiesService } = buildTestCrmServices(db, projectsService);
  const { schedulesService, predictiveScheduleRiskService, queueConnection, cacheRedis } = buildTestSchedulingServices(db);
  const financeAlertsQueryService = new FinanceAlertsQueryService(db);
  const cashflowForecastService = new CashflowForecastService(db, new AiGatewayService(db, new FakeAiProvider()));
  const { aiGatewayService: briefingAiGateway } = buildTestAiServices(db);
  const executiveBriefingService = buildTestExecutiveBriefingService(
    db,
    opportunitiesService,
    financeAlertsQueryService,
    predictiveScheduleRiskService,
    schedulesService,
    cashflowForecastService,
    briefingAiGateway,
  );
  const { agents, redis: agentsRedis } = buildTestAgentIdentitiesService(db);
  const runner = buildTestExecutiveBriefingAgentRunner(db, agents, executiveBriefingService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await agentsRedis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
  });

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `exec-briefing-agent-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `ExecBriefingAgent ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    return { tenantId: signUp.companyId, ownerId };
  }

  // Documented convention (api.md §15.6), same "role needs the resource
  // permission a human doing the equivalent thing would need" precedent as
  // every other agent's own test setup, even though generate() itself
  // doesn't check it.
  async function createAgentRole(tenantId: string, ownerId: string, name: string) {
    return withTenant(db, tenantId, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId, name, createdBy: ownerId }).returning();
      await tx.insert(rolePermissions).values([{ tenantId, roleId: role!.id, permissionKey: "dashboard.company.read" }]);
      return role!;
    });
  }

  async function outboxRowsFor(tenantId: string, eventType: string) {
    return withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) })).then((rows) =>
      rows.filter((r) => r.eventType === eventType),
    );
  }

  it("generates a briefing on tick, attributed to the agent as actor_type='ai', notifying the agent's creator", async () => {
    const { tenantId, ownerId } = await signUpCompany("happy");
    const role = await createAgentRole(tenantId, ownerId, "Briefing Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Executive Briefing Agent",
      purpose: "Generates the weekly executive briefing.",
      roleId: role.id,
      toolAllowlist: ["generate_executive_briefing"],
    });

    await runner.runTick();

    const briefings = await withTenant(db, tenantId, (tx) => tx.query.companyBriefings.findMany());
    expect(briefings).toHaveLength(1);

    const events = await outboxRowsFor(tenantId, "company_briefing.generated.v1");
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe(agent.userId);
    expect(events[0]!.actorType).toBe("ai");
    expect((events[0]!.payload as { notifyUserId: string | null }).notifyUserId).toBe(ownerId);
  });

  it("skips a paused agent (kill-switch) without erroring the whole tick", async () => {
    const { tenantId, ownerId } = await signUpCompany("paused");
    const role = await createAgentRole(tenantId, ownerId, "Briefing Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Executive Briefing Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["generate_executive_briefing"],
    });
    await agents.pause(tenantId, ownerId, agent.id);

    await expect(runner.runTick()).resolves.toBeUndefined();

    const briefings = await withTenant(db, tenantId, (tx) => tx.query.companyBriefings.findMany());
    expect(briefings).toHaveLength(0);
  });

  it("RLS: a tick only ever touches its own tenant's company_briefings", async () => {
    const other = await signUpCompany("bystander");
    const { tenantId, ownerId } = await signUpCompany("acting");
    const role = await createAgentRole(tenantId, ownerId, "Briefing Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Executive Briefing Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["generate_executive_briefing"],
    });

    await runner.runTick();

    const briefingsOther = await withTenant(db, other.tenantId, (tx) => tx.query.companyBriefings.findMany());
    expect(briefingsOther).toHaveLength(0);
    const briefingsActing = await withTenant(db, tenantId, (tx) => tx.query.companyBriefings.findMany());
    expect(briefingsActing.every((b) => b.tenantId === tenantId)).toBe(true);
  });
});
