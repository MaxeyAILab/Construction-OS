import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { companyBriefings, financeAlerts, outbox, schedules } from "../src/infrastructure/db/schema";
import { AiGatewayService } from "../src/modules/ai/application/ai-gateway.service";
import { CashflowForecastService } from "../src/modules/finance-alerts/application/cashflow-forecast.service";
import { FinanceAlertsQueryService } from "../src/modules/finance-alerts/application/finance-alerts-query.service";
import { FakeAiProvider } from "./setup/ai";
import { buildTestAiServices } from "./setup/ai";
import { buildTestAuthService } from "./setup/auth";
import { buildTestCrmServices } from "./setup/crm";
import { buildTestExecutiveBriefingService } from "./setup/dashboards";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSchedulingServices } from "./setup/scheduling";

// api.md §14 `POST /dashboards/company/briefing` / `GET
// /dashboards/company/briefings` (FR-EXEC-3, ai-spec.md §7.1 "weekly
// proactive briefing"). Covers ExecutiveBriefingService's aggregation
// (finance alerts, cross-project schedule risk, weighted pipeline, cash
// flow) and persistence — not the underlying primitives' own math (see
// finance-alerts.spec.ts, scheduling.spec.ts's "Predictive schedule risk"
// block, and finance-cashflow-forecast.spec.ts for that). FinanceAlerts/
// Cashflow services are wired directly here (not via
// buildTestFinanceAlertsServices) since this suite needs neither
// InvoiceAnomalyService nor MarginErosionService's own dependency chain —
// only the two read services ExecutiveBriefingService actually composes.
describe("Executive Briefing (FR-EXEC-3)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { opportunitiesService, pipelineStagesService } = buildTestCrmServices(db, projectsService);
  const {
    schedulesService,
    activitiesService,
    recalculateService,
    predictiveScheduleRiskService,
    queueConnection,
    cacheRedis,
  } = buildTestSchedulingServices(db);
  const financeAlertsQueryService = new FinanceAlertsQueryService(db);
  const cashflowAiProvider = new FakeAiProvider();
  const cashflowForecastService = new CashflowForecastService(db, new AiGatewayService(db, cashflowAiProvider));
  const { aiGatewayService: briefingAiGateway, provider: briefingAiProvider } = buildTestAiServices(db);
  const executiveBriefingService = buildTestExecutiveBriefingService(
    db,
    opportunitiesService,
    financeAlertsQueryService,
    predictiveScheduleRiskService,
    schedulesService,
    cashflowForecastService,
    briefingAiGateway,
  );

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
  });

  async function signUpCompanyWithActiveProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `exec-briefing-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `ExecBriefing ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const created = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
    });
    const project = await projectsService.update(signUp.companyId, ownerId, created.id, { status: "active" }, created.updatedSeq);
    return { tenantId: signUp.companyId, ownerId, project };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function backdateBaseline(tenantId: string, scheduleId: string, daysAgo: number) {
    const pastDate = new Date(Date.now() - daysAgo * 86_400_000);
    await withTenant(db, tenantId, (tx) => tx.update(schedules).set({ createdAt: pastDate }).where(eq(schedules.id, scheduleId)));
  }

  async function insertMarginErosionAlert(tenantId: string, projectId: string) {
    await withTenant(db, tenantId, (tx) =>
      tx.insert(financeAlerts).values({
        tenantId,
        projectId,
        kind: "margin_erosion",
        severity: "critical",
        marginPct: "5.00",
        thresholdPct: "10.00",
      }),
    );
  }

  it("aggregates finance alerts, cross-project schedule risk, weighted pipeline, and cash flow into one persisted snapshot", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithActiveProject("agg");

    await insertMarginErosionAlert(tenantId, project.id);

    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    const driver = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Driver", durationDays: 10 });
    await recalculateService.recalculate(tenantId, ownerId, schedule.id);
    const { schedule: baseline } = await schedulesService.createBaseline(tenantId, ownerId, project.id, { name: "Plan" });
    await backdateBaseline(tenantId, baseline.id, 10);
    // No further edits: Driver has no successors -> stays critical
    // (float 0), which predictive schedule risk always surfaces.
    await recalculateService.recalculate(tenantId, ownerId, schedule.id);

    const stage = await pipelineStagesService.create(tenantId, ownerId, { name: "Qualified", displayOrder: 1 });
    await opportunitiesService.create(tenantId, ownerId, {
      name: "Big Deal",
      stageId: stage.id,
      expectedValueAmount: "200000.00",
      probability: "50.00",
    });

    briefingAiProvider.setResponse({ content: "Pipeline is healthy but watch the Driver activity.", inputTokens: 10, outputTokens: 10 });

    const briefing = await executiveBriefingService.generate(tenantId, ownerId, ownerId);

    expect(briefing.summary.openFinanceAlertCount).toBe(1);
    expect(briefing.summary.criticalScheduleRiskCount).toBe(1);
    expect(briefing.summary.highScheduleRiskCount).toBe(0);
    expect(briefing.summary.pipelineWeightedValueAmount).toBe("100000.00");
    expect(briefing.summary.netCashFlowNext4WeeksAmount).toBe("0.00");
    expect(briefing.summary.topAnomalies.some((a) => a.kind === "margin_erosion")).toBe(true);
    expect(briefing.summary.topAnomalies.some((a) => a.kind === "schedule_risk_critical" && a.entityId === driver.id)).toBe(true);
    expect(briefing.narrative).toBe("Pipeline is healthy but watch the Driver activity.");
    expect(briefing.aiRunId).not.toBeNull();

    const persisted = await withTenant(db, tenantId, (tx) =>
      tx.query.companyBriefings.findFirst({ where: eq(companyBriefings.id, briefing.id) }),
    );
    expect(persisted).toBeDefined();
    expect(persisted!.narrative).toBe(briefing.narrative);

    const events = await withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }));
    const event = events.find((e) => e.eventType === "company_briefing.generated.v1");
    expect(event?.actorId).toBe(ownerId);
    expect((event?.payload as { notifyUserId: string | null }).notifyUserId).toBe(ownerId);
  });

  it("degrades to a null narrative (never an empty briefing) when the AI call fails", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithActiveProject("ai-fail");
    briefingAiProvider.setShouldThrow(true);

    const briefing = await executiveBriefingService.generate(tenantId, ownerId, null);

    expect(briefing.narrative).toBeNull();
    expect(briefing.aiRunId).toBeNull();
    expect(briefing.summary.openFinanceAlertCount).toBe(0);

    briefingAiProvider.setShouldThrow(false);
  });

  it("list() returns generated briefings newest first, respecting the limit", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithActiveProject("list");
    const first = await executiveBriefingService.generate(tenantId, ownerId, null);
    const second = await executiveBriefingService.generate(tenantId, ownerId, null);

    const list = await executiveBriefingService.list(tenantId, 1);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(second.id);
    expect(list[0]!.id).not.toBe(first.id);
  });

  it("RLS: a tenant only sees its own company_briefings", async () => {
    const a = await signUpCompanyWithActiveProject("rls-a");
    const b = await signUpCompanyWithActiveProject("rls-b");
    await executiveBriefingService.generate(a.tenantId, a.ownerId, null);

    const briefingsB = await withTenant(db, b.tenantId, (tx) => tx.query.companyBriefings.findMany());
    expect(briefingsB).toHaveLength(0);
  });
});
