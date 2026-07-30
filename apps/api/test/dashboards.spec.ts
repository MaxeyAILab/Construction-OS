import type { OutboxEnvelope } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { opportunities, outbox, projectionProjectFinancials } from "../src/infrastructure/db/schema";
import { buildTestAiServices } from "./setup/ai";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { buildTestCrmServices } from "./setup/crm";
import { buildTestDashboardsServices, buildTestWhatIfSimulationService } from "./setup/dashboards";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestFileServices } from "./setup/files";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestReportsServices } from "./setup/reports";
import { buildTestRfisServices } from "./setup/rfis";
import { buildTestSchedulingServices } from "./setup/scheduling";
import { buildTestTasksServices } from "./setup/tasks";
import {
  OpportunityNotOpenError,
  ProjectNotFoundError,
  ReportDefinitionNotFoundError,
  WhatIfScheduleMismatchError,
} from "../src/modules/dashboards/domain/errors";

describe("Executive Dashboard v1: projections + aggregate reads", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { dashboardsService, projectionsWriterService } = buildTestDashboardsServices(db);
  const {
    schedulesService,
    activitiesService,
    dependenciesService,
    recalculateService,
    resourceAssignmentsService,
    delayImpactService,
    queueConnection,
    cacheRedis,
  } = buildTestSchedulingServices(db);
  const { opportunitiesService, pipelineStagesService } = buildTestCrmServices(db, projectsService);
  const { aiGatewayService: whatIfAiGateway } = buildTestAiServices(db);
  const whatIfSimulationService = buildTestWhatIfSimulationService(
    opportunitiesService,
    resourceAssignmentsService,
    delayImpactService,
    whatIfAiGateway,
  );
  const { tasksService } = buildTestTasksServices(db);
  const { rfisService } = buildTestRfisServices(db);
  const { fileUploadService } = buildTestFileServices(db);
  const {
    reportsService,
    reportRunnerService,
    queueConnection: reportsQueueConnection,
    cacheRedis: reportsCacheRedis,
  } = buildTestReportsServices(db, dashboardsService, fileUploadService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
    await reportsQueueConnection.quit();
    await reportsCacheRedis.quit();
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

  // Portfolio analytics & custom report builder (FR-EXEC-2, api.md §14,
  // Phase 3). Formalizes DashboardsService's existing aggregates into a
  // durable PDF artifact — runner.run() is called directly (bypassing the
  // BullMQ worker) for deterministic tests, same precedent as
  // payment-applications.spec.ts's pdfRunnerService.run() calls.
  describe("Reports (FR-EXEC-2)", () => {
    it("creates a project_summary definition, runs it, and files the PDF as a document version", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("report-project");

      const definition = await reportsService.create(tenantId, ownerId, {
        name: "Weekly Project Snapshot",
        kind: "project_summary",
        params: { projectId: project.id },
      });
      expect(definition.kind).toBe("project_summary");

      const run = await reportsService.requestRun(tenantId, ownerId, definition.id);
      expect(run.status).toBe("queued");

      await reportRunnerService.run({ tenantId, actorId: ownerId, reportDefinitionId: definition.id, reportRunId: run.id });

      const completed = await reportsService.getRun(tenantId, run.id);
      expect(completed.status).toBe("completed");
      expect(completed.fileId).not.toBeNull();
      expect(completed.documentId).not.toBeNull();
      expect(completed.documentVersionId).not.toBeNull();
      expect(completed.downloadUrl).not.toBeNull();
    });

    it("creates a company_summary definition, runs it, and stores only the generated file (no project to file a document under)", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("report-company");

      const definition = await reportsService.create(tenantId, ownerId, {
        name: "Portfolio Overview",
        kind: "company_summary",
      });

      const run = await reportsService.requestRun(tenantId, ownerId, definition.id);
      await reportRunnerService.run({ tenantId, actorId: ownerId, reportDefinitionId: definition.id, reportRunId: run.id });

      const completed = await reportsService.getRun(tenantId, run.id);
      expect(completed.status).toBe("completed");
      expect(completed.fileId).not.toBeNull();
      expect(completed.documentId).toBeNull();
      expect(completed.documentVersionId).toBeNull();
      expect(completed.downloadUrl).not.toBeNull();
    });

    it("rejects running a nonexistent report definition", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("report-missing");
      await expect(
        reportsService.requestRun(tenantId, ownerId, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow(ReportDefinitionNotFoundError);
    });

    it("updates a definition's name/schedule/recipients while kind/params stay fixed", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("report-update");
      const definition = await reportsService.create(tenantId, ownerId, {
        name: "Monthly Portfolio",
        kind: "company_summary",
      });

      const updated = await reportsService.update(tenantId, ownerId, definition.id, {
        name: "Monthly Portfolio (renamed)",
        schedule: "0 0 1 * *",
        recipients: ["cfo@example.com"],
      });

      expect(updated.name).toBe("Monthly Portfolio (renamed)");
      expect(updated.schedule).toBe("0 0 1 * *");
      expect(updated.recipients).toEqual(["cfo@example.com"]);
      expect(updated.kind).toBe("company_summary");
    });

    it("RLS: a tenant only sees its own report definitions", async () => {
      const a = await signUpCompanyWithProject("report-rls-a");
      const b = await signUpCompanyWithProject("report-rls-b");
      await reportsService.create(a.tenantId, a.ownerId, { name: "A's report", kind: "company_summary" });

      const listB = await reportsService.list(b.tenantId, { limit: 20 });
      expect(listB.data).toHaveLength(0);
    });
  });

  // What-if simulation (FR-EXEC-4, ai-spec.md §7.1 "what-if sketches",
  // roadmap.md Phase 3 "bid loss, crew moves, delay cascades"). Each
  // scenario's numbers are deterministic (pipeline math / CPM re-runs) —
  // the AI narrative is a best-effort extra, not asserted on here (the fake
  // provider's canned response is exercised in the AI Gateway's own tests).
  describe("What-if simulation (FR-EXEC-4)", () => {
    it("bid_loss: reduces the weighted pipeline by exactly the lost opportunity's weighted value", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("whatif-bid");
      const stage = await pipelineStagesService.create(tenantId, ownerId, { name: "Qualified", displayOrder: 1 });

      const kept = await opportunitiesService.create(tenantId, ownerId, {
        name: "Kept Deal",
        stageId: stage.id,
        expectedValueAmount: "100000.00",
        probability: "50.00",
      });
      const lost = await opportunitiesService.create(tenantId, ownerId, {
        name: "Harbor Bid",
        stageId: stage.id,
        expectedValueAmount: "200000.00",
        probability: "25.00",
      });

      // before = 100000*0.5 + 200000*0.25 = 100000; after = 50000.
      const result = await whatIfSimulationService.simulate(tenantId, ownerId, {
        type: "bid_loss",
        opportunityId: lost.id,
      });

      expect(result.type).toBe("bid_loss");
      if (result.type !== "bid_loss") throw new Error("unreachable");
      expect(result.pipelineWeightedValueBefore).toBe("100000.00");
      expect(result.lostWeightedValueAmount).toBe("50000.00");
      expect(result.pipelineWeightedValueAfter).toBe("50000.00");
      expect(result.pipelineWeightedValueDeltaPct).toBe(-50);

      // sanity: the kept opportunity's own weighted value is unaffected.
      const stillOpen = await opportunitiesService.listOpenForPipeline(tenantId);
      expect(stillOpen.find((o) => o.id === kept.id)).toBeDefined();
    });

    it("bid_loss: rejects simulating the loss of an opportunity that's already won or lost", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("whatif-bid-closed");
      const stage = await pipelineStagesService.create(tenantId, ownerId, { name: "Qualified", displayOrder: 1 });
      const opportunity = await opportunitiesService.create(tenantId, ownerId, {
        name: "Already Lost Deal",
        stageId: stage.id,
        expectedValueAmount: "50000.00",
        probability: "50.00",
      });

      await withTenant(db, tenantId, (tx) =>
        tx.update(opportunities).set({ status: "lost", lostReason: "budget" }).where(eq(opportunities.id, opportunity.id)),
      );

      await expect(
        whatIfSimulationService.simulate(tenantId, ownerId, { type: "bid_loss", opportunityId: opportunity.id }),
      ).rejects.toThrow(OpportunityNotOpenError);
    });

    it("delay_cascade: combines multiple simultaneous activity delays into one project-end shift", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("whatif-cascade");
      const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
      const a = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Sitework", durationDays: 5 });
      const b = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Foundation", durationDays: 10 });
      await dependenciesService.replace(tenantId, ownerId, b.id, {
        dependencies: [{ predecessorId: a.id, type: "FS", lagDays: 0 }],
      });
      const c = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Permitting", durationDays: 3 });

      const result = await whatIfSimulationService.simulate(tenantId, ownerId, {
        type: "delay_cascade",
        scheduleId: schedule.id,
        delays: [
          { activityId: a.id, days: 2 },
          { activityId: c.id, days: 1 },
        ],
      });

      expect(result.type).toBe("delay_cascade");
      if (result.type !== "delay_cascade") throw new Error("unreachable");
      // A's chain (A -> B, 5+10=15 days) is critical; delaying A by 2 pushes
      // the whole chain (and project end) by 2. C (duration 3, plenty of
      // float against a 15-day project) never becomes the driver.
      expect(result.projectEndDelayDays).toBe(2);
      expect(result.criticalPathImpacted).toBe(true);
      const affectedIds = result.affectedActivities.map((x) => x.id);
      expect(affectedIds).toContain(a.id);
      expect(affectedIds).toContain(b.id);
    });

    it("crew_move: treats losing a resource for its assigned window as an equivalent activity delay and flags a new conflict at the target", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("whatif-crew");
      const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
      const fromActivity = await activitiesService.create(tenantId, ownerId, schedule.id, {
        name: "Framing",
        durationDays: 5,
      });
      const targetActivity = await activitiesService.create(tenantId, ownerId, schedule.id, {
        name: "Drywall",
        durationDays: 5,
      });

      const startAt = "2025-06-01T08:00:00.000Z";
      const endAt = "2025-06-04T08:00:00.000Z"; // exactly 3 days
      const moved = await resourceAssignmentsService.create(tenantId, ownerId, fromActivity.id, {
        resourceType: "crew",
        crewLabel: "Framing Crew",
        startAt,
        endAt,
      });
      // Already booked on the target activity for the same window/crew —
      // moving `moved` there should collide with this one.
      const existingOnTarget = await resourceAssignmentsService.create(tenantId, ownerId, targetActivity.id, {
        resourceType: "crew",
        crewLabel: "Framing Crew",
        startAt,
        endAt,
      });

      const result = await whatIfSimulationService.simulate(tenantId, ownerId, {
        type: "crew_move",
        scheduleId: schedule.id,
        resourceAssignmentIds: [moved.id],
        targetActivityId: targetActivity.id,
      });

      expect(result.type).toBe("crew_move");
      if (result.type !== "crew_move") throw new Error("unreachable");
      expect(result.movedAssignments).toEqual([
        { resourceAssignmentId: moved.id, fromActivityId: fromActivity.id, fromActivityName: "Framing", lostDays: 3 },
      ]);
      expect(result.newConflicts).toEqual([
        { resourceAssignmentId: moved.id, conflictingAssignmentId: existingOnTarget.id },
      ]);
      // fromActivity (duration 5) and targetActivity (duration 5) start tied
      // for the critical path; losing the crew extends fromActivity to 8
      // days, which now solely drives the (still-unconnected) project end.
      expect(result.projectEndDelayDays).toBe(3);
    });

    it("crew_move: rejects resource assignments that don't belong to the given schedule", async () => {
      const { tenantId, ownerId, project: projectA } = await signUpCompanyWithProject("whatif-crew-mismatch");
      const projectB = await projectsService.create(tenantId, ownerId, {
        name: "Second Project",
        code: "WHATIF-CREW-B",
        currency: "USD",
      });
      const { schedule: scheduleA } = await schedulesService.getActiveSchedule(tenantId, ownerId, projectA.id);
      const { schedule: scheduleB } = await schedulesService.getActiveSchedule(tenantId, ownerId, projectB.id);
      const activityOnB = await activitiesService.create(tenantId, ownerId, scheduleB.id, {
        name: "Project B's Activity",
        durationDays: 5,
      });
      const assignmentOnB = await resourceAssignmentsService.create(tenantId, ownerId, activityOnB.id, {
        resourceType: "crew",
        crewLabel: "Crew",
        startAt: "2025-06-01T08:00:00.000Z",
        endAt: "2025-06-02T17:00:00.000Z",
      });

      // assignmentOnB's activity actually belongs to scheduleB, not scheduleA
      // — the mismatch guard rejects before any CPM re-run is attempted.
      await expect(
        whatIfSimulationService.simulate(tenantId, ownerId, {
          type: "crew_move",
          scheduleId: scheduleA.id,
          resourceAssignmentIds: [assignmentOnB.id],
        }),
      ).rejects.toThrow(WhatIfScheduleMismatchError);
    });
  });
});
