import type { OutboxEnvelope } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox, projectionProjectFinancials } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { buildTestDashboardsServices } from "./setup/dashboards";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRfisServices } from "./setup/rfis";
import { buildTestSchedulingServices } from "./setup/scheduling";
import { buildTestTasksServices } from "./setup/tasks";
import { ProjectNotFoundError } from "../src/modules/dashboards/domain/errors";

describe("Executive Dashboard v1: projections + aggregate reads", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { dashboardsService, projectionsWriterService } = buildTestDashboardsServices(db);
  const { schedulesService, activitiesService, dependenciesService, recalculateService, queueConnection, cacheRedis } =
    buildTestSchedulingServices(db);
  const { tasksService } = buildTestTasksServices(db);
  const { rfisService } = buildTestRfisServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `dash-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Dash ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    return { tenantId: signUp.companyId, ownerId, project };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  // Bypasses NATS entirely (same approach as audit.spec.ts/notifications.spec.ts)
  // — reads the outbox rows a real service call produced, replays each as an
  // envelope directly into the writer.
  async function replayOutboxToProjections(tenantId: string): Promise<void> {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    );
    for (const row of rows) {
      const envelope: OutboxEnvelope = {
        id: row.id,
        tenantId: row.tenantId,
        eventType: row.eventType,
        payload: row.payload,
        dedupeKey: row.dedupeKey,
        occurredAt: row.occurredAt.toISOString(),
        actorId: row.actorId,
        actorType: row.actorType as OutboxEnvelope["actorType"],
      };
      await projectionsWriterService.handleEnvelope(envelope);
    }
  }

  it("a brand-new project has no financials projection yet and a zeroed company dashboard", async () => {
    const { tenantId, project } = await signUpCompanyWithProject("empty");
    await replayOutboxToProjections(tenantId); // project.created.v1 -> company kpis

    const projectDash = await dashboardsService.getProject(tenantId, project.id);
    expect(projectDash.profitability).toBeNull();
    expect(projectDash.risk).toEqual({ criticalActivityCount: 0, overdueTaskCount: 0, openRfiCount: 0 });

    const companyDash = await dashboardsService.getCompany(tenantId);
    expect(companyDash.projectCount).toBe(1);
    // A freshly created project defaults to status='planning', not 'active'.
    expect(companyDash.activeProjectCount).toBe(0);
    expect(companyDash.profitability.totalRevisedAmount).toBe("0.00");
    expect(companyDash.pipelineValueAmount).toBeNull();
    expect(companyDash.cashPositionAmount).toBeNull();
  });

  it("throws for an unknown project id", async () => {
    const { tenantId } = await signUpCompanyWithProject("missing");
    await expect(dashboardsService.getProject(tenantId, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      ProjectNotFoundError,
    );
  });

  it("a budget's lines roll up into the project financials projection and the company rollup", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("budget");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "General Conditions",
      kind: "other",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, {
      costCodeId: costCode.id,
      originalAmount: "100000.00",
    });

    await replayOutboxToProjections(tenantId);

    const projectDash = await dashboardsService.getProject(tenantId, project.id);
    expect(projectDash.profitability).not.toBeNull();
    expect(projectDash.profitability!.revisedTotalAmount).toBe("100000.00");
    expect(projectDash.profitability!.forecastAtCompletionAmount).toBe("100000.00");
    // contractValueAmount 1,000,000 - forecast 100,000 = 900,000 margin.
    expect(projectDash.profitability!.marginAmount).toBe("900000.00");

    const companyDash = await dashboardsService.getCompany(tenantId);
    expect(companyDash.profitability.totalRevisedAmount).toBe("100000.00");
    expect(companyDash.profitability.totalMarginAmount).toBe("900000.00");

    const row = await withTenant(db, tenantId, (tx) =>
      tx.query.projectionProjectFinancials.findFirst({
        where: eq(projectionProjectFinancials.projectId, project.id),
      }),
    );
    expect(row?.originalTotalAmount).toBe("100000.00");
  });

  it("sums financials across every project in the company dashboard", async () => {
    const { tenantId, ownerId, project: projectA } = await signUpCompanyWithProject("multi-a");
    const projectB = await projectsService.create(tenantId, ownerId, {
      name: "Second Project",
      code: "MULTI-B-1",
      currency: "USD",
      contractValueAmount: "500000.00",
    });

    for (const project of [projectA, projectB]) {
      const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
      const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
        code: "01",
        name: "GC",
        kind: "other",
      });
      await budgetService.addLine(tenantId, ownerId, budget.id, {
        costCodeId: costCode.id,
        originalAmount: "50000.00",
      });
    }

    await replayOutboxToProjections(tenantId);

    const companyDash = await dashboardsService.getCompany(tenantId);
    expect(companyDash.projectCount).toBe(2);
    expect(companyDash.profitability.totalRevisedAmount).toBe("100000.00");
  });

  it("counts critical schedule activities, overdue tasks, and open RFIs as live risk signals", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("risk");
    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    const a = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Foundation", durationDays: 5 });
    const b = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Framing", durationDays: 10 });
    await dependenciesService.replace(tenantId, ownerId, b.id, {
      dependencies: [{ predecessorId: a.id, type: "FS", lagDays: 0 }],
    });
    await recalculateService.recalculate(tenantId, ownerId, schedule.id); // both activities become critical

    await tasksService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Overdue inspection",
      dueDate: "2020-01-01",
    });

    await rfisService.create(tenantId, ownerId, project.id, {
      subject: "Clarify footing detail",
      question: "What is the footing depth at grid C4?",
    });

    const projectDash = await dashboardsService.getProject(tenantId, project.id);
    expect(projectDash.risk.criticalActivityCount).toBe(2);
    expect(projectDash.risk.overdueTaskCount).toBe(1);
    expect(projectDash.risk.openRfiCount).toBe(1);

    const companyDash = await dashboardsService.getCompany(tenantId);
    expect(companyDash.risk.criticalActivityCount).toBe(2);
    expect(companyDash.risk.overdueTaskCount).toBe(1);
    expect(companyDash.risk.openRfiCount).toBe(1);
  });

  it("RLS: a tenant only sees its own projection rows", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const budgetA = await budgetService.create(a.tenantId, a.ownerId, a.project.id, { currency: "USD" });
    const costCodeA = await costCodesService.create(a.tenantId, a.ownerId, a.project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    await budgetService.addLine(a.tenantId, a.ownerId, budgetA.id, {
      costCodeId: costCodeA.id,
      originalAmount: "1000.00",
    });
    await replayOutboxToProjections(a.tenantId);
    await replayOutboxToProjections(b.tenantId);

    const financialsB = await withTenant(db, b.tenantId, (tx) => tx.query.projectionProjectFinancials.findMany());
    expect(financialsB).toHaveLength(0);

    const kpisB = await withTenant(db, b.tenantId, (tx) => tx.query.projectionCompanyKpis.findMany());
    expect(kpisB.every((r) => r.tenantId === b.tenantId)).toBe(true);
    expect(kpisB.some((r) => r.tenantId === a.tenantId)).toBe(false);

    const financialsA = await withTenant(db, a.tenantId, (tx) => tx.query.projectionProjectFinancials.findMany());
    expect(financialsA.length).toBeGreaterThan(0);
    expect(financialsA.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });
});
