import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox, rolePermissions, roles } from "../src/infrastructure/db/schema";
import { buildTestAgentIdentitiesService, buildTestBillingAgentRunner } from "./setup/agents";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { buildTestCrmServices } from "./setup/crm";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestFileServices } from "./setup/files";
import { buildTestFinanceServices } from "./setup/finance";
import { buildTestInventoryServices } from "./setup/inventory";
import { buildTestPaymentApplicationServices } from "./setup/payment-applications";
import { buildTestProcurementServices } from "./setup/procurement";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSchedulingServices } from "./setup/scheduling";
import { buildTestSubcontractorServices } from "./setup/subcontractors";

// api.md §15.3 "Billing Agent" (ai-spec.md §15). The monthly tick
// (BillingAgentRunnerService.runTick, tested directly here rather than
// through BillingAgentWorker's BullMQ scheduling) composes existing,
// separately-tested use-cases — BudgetService.getByProject,
// SchedulesService.getActiveSchedule, PaymentApplicationsService.create/
// submit — under a declared agent's own actor. These tests cover the new
// composition: the percent-complete-by-cost-code rollup, active-project
// scoping, actor_type='ai' attribution, and kill-switch integration — not
// PaymentApplicationsService's own internals (see payment-applications.spec.ts).
describe("Billing Agent: monthly tick (assemble + route pay apps)", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService, costTransactionsService } = buildTestBudgetServices(db);
  const { stockService } = buildTestInventoryServices(db);
  const { schedulesService, activitiesService, queueConnection, cacheRedis } = buildTestSchedulingServices(db);
  const { suppliersService, purchaseOrdersService, redis: procurementRedis } = buildTestProcurementServices(
    db,
    stockService,
    schedulesService,
    budgetService,
  );
  const { contactCompaniesService } = buildTestCrmServices(db, projectsService);
  const { subcontractorsService } = buildTestSubcontractorServices(db);
  const { invoicesService } = buildTestFinanceServices(db, {
    purchaseOrdersService,
    suppliersService,
    subcontractorsService,
    contactCompaniesService,
    costTransactionsService,
  });
  const { fileUploadService, queueConnection: fileQueueConnection } = buildTestFileServices(db);
  const { paymentApplicationsService, queueConnection: payAppQueueConnection, cacheRedis: payAppCacheRedis } =
    buildTestPaymentApplicationServices(db, invoicesService, fileUploadService);
  const { agents, redis: agentsRedis } = buildTestAgentIdentitiesService(db);
  const runner = buildTestBillingAgentRunner(db, agents, budgetService, schedulesService, paymentApplicationsService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await procurementRedis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
    await fileQueueConnection.quit();
    await payAppQueueConnection.quit();
    await payAppCacheRedis.quit();
    await agentsRedis.quit();
  });

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function signUpCompanyWithActiveProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `billing-agent-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `BillingAgent ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    await projectsService.update(signUp.companyId, ownerId, project.id, { status: "active" });
    return { tenantId: signUp.companyId, ownerId, project };
  }

  // The agent's role needs schedule.read (SchedulesService.getActiveSchedule's
  // own authorization gate) plus finance.payapp.create (covers create, add
  // line, and submit) — the same permissions a human calling the equivalent
  // endpoints would need.
  async function createAgentRole(tenantId: string, ownerId: string, name: string) {
    return withTenant(db, tenantId, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId, name, createdBy: ownerId }).returning();
      await tx.insert(rolePermissions).values([
        { tenantId, roleId: role!.id, permissionKey: "schedule.read" },
        { tenantId, roleId: role!.id, permissionKey: "finance.payapp.create" },
      ]);
      return role!;
    });
  }

  async function outboxRowsFor(tenantId: string, eventType: string) {
    return withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) })).then(
      (rows) => rows.filter((r) => r.eventType === eventType),
    );
  }

  it("assembles a pay app from the schedule %-complete rollup and routes it, attributed to the agent as actor_type='ai'", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithActiveProject("happy");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "BA-H",
      name: "Billing agent happy",
      kind: "other",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "1000.00" });

    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    await activitiesService.create(tenantId, ownerId, schedule.id, {
      name: "Happy work",
      durationDays: 2,
      costCodeId: costCode.id,
      percentComplete: 50,
    });

    const role = await createAgentRole(tenantId, ownerId, "Billing Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Billing Agent",
      purpose: "Assembles monthly pay apps from schedule progress and routes them for approval.",
      roleId: role.id,
      toolAllowlist: ["assemble_and_route_pay_applications"],
    });

    await runner.runTick();

    const payApps = await paymentApplicationsService.listForProject(tenantId, project.id, { limit: 20 });
    expect(payApps).toHaveLength(1);
    const drafted = await paymentApplicationsService.getById(tenantId, payApps[0]!.id);
    expect(drafted.status).toBe("submitted"); // submitted, not left in draft — "routed"

    const line = drafted.lines.find((l) => l.costCodeId === costCode.id);
    expect(line).toBeDefined();
    expect(line!.scheduledValue).toBe("1000.00");
    expect(line!.previousCompleted).toBe("0.00");
    expect(line!.thisPeriod).toBe("500.00"); // 50% of 1000.00 - 0 previously billed

    const createdEvents = await outboxRowsFor(tenantId, "payment_application.created.v1");
    const createdEvent = createdEvents.find(
      (e) => (e.payload as { paymentApplicationId: string }).paymentApplicationId === drafted.id,
    );
    expect(createdEvent?.actorId).toBe(agent.userId);
    expect(createdEvent?.actorType).toBe("ai");
  });

  it("leaves a cost code with no linked schedule activity alone (no line, no pay app when nothing else qualifies)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithActiveProject("nosignal");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "BA-N",
      name: "Billing agent no-signal",
      kind: "other",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "1000.00" });
    // Deliberately no schedule activity referencing this cost code.
    await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);

    const role = await createAgentRole(tenantId, ownerId, "Billing Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Billing Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["assemble_and_route_pay_applications"],
    });

    await runner.runTick();

    const payApps = await paymentApplicationsService.listForProject(tenantId, project.id, { limit: 20 });
    expect(payApps).toHaveLength(0);
  });

  it("ignores a project that isn't active (still in planning)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `billing-agent-planning-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `BillingAgent Planning ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const tenantId = signUp.companyId;
    // Deliberately left in the default 'planning' status.
    const project = await projectsService.create(tenantId, ownerId, {
      name: "Planning Project",
      code: "BAPLAN-1",
      currency: "USD",
      contractValueAmount: "500000.00",
    });
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "BA-P",
      name: "Billing agent planning",
      kind: "other",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "1000.00" });
    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    await activitiesService.create(tenantId, ownerId, schedule.id, {
      name: "Planning work",
      durationDays: 2,
      costCodeId: costCode.id,
      percentComplete: 50,
    });

    const role = await createAgentRole(tenantId, ownerId, "Billing Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Billing Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["assemble_and_route_pay_applications"],
    });

    await runner.runTick();

    const payApps = await paymentApplicationsService.listForProject(tenantId, project.id, { limit: 20 });
    expect(payApps).toHaveLength(0);
  });

  it("skips a paused agent (kill-switch) without erroring the whole tick", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithActiveProject("paused");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "BA-K",
      name: "Billing agent paused",
      kind: "other",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "1000.00" });
    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    await activitiesService.create(tenantId, ownerId, schedule.id, {
      name: "Paused work",
      durationDays: 2,
      costCodeId: costCode.id,
      percentComplete: 50,
    });

    const role = await createAgentRole(tenantId, ownerId, "Billing Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Billing Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["assemble_and_route_pay_applications"],
    });
    await agents.pause(tenantId, ownerId, agent.id);

    await expect(runner.runTick()).resolves.toBeUndefined();

    const payApps = await paymentApplicationsService.listForProject(tenantId, project.id, { limit: 20 });
    expect(payApps).toHaveLength(0);
  });
});
