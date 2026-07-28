import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox, rolePermissions, roles } from "../src/infrastructure/db/schema";
import { buildTestAgentIdentitiesService, buildTestProcurementAgentRunner } from "./setup/agents";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestInventoryServices } from "./setup/inventory";
import { buildTestProcurementServices } from "./setup/procurement";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSchedulingServices } from "./setup/scheduling";

// api.md §15.2 "Procurement Agent" (ai-spec.md §15). The daily tick
// (ProcurementAgentRunnerService.runTick, tested directly here rather than
// through ProcurementAgentWorker's BullMQ scheduling) composes existing,
// separately-tested use-cases — ProcurementNeedsService.draftFromNeeds and
// PurchaseOrderLifecycleService.submit — under a declared agent's own
// actor. These tests cover the new composition: multi-agent/multi-project
// enumeration, active-project scoping, actor_type='ai' attribution, and
// kill-switch integration — not draftFromNeeds'/submit's own internals
// (see procurement.spec.ts for those).
describe("Procurement Agent: daily tick (draft + route POs)", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { stockService } = buildTestInventoryServices(db);
  const { schedulesService, activitiesService, recalculateService, queueConnection, cacheRedis } =
    buildTestSchedulingServices(db);
  const {
    suppliersService,
    purchaseOrdersService,
    lifecycleService,
    procurementNeedsService,
    redis: procurementRedis,
  } = buildTestProcurementServices(db, stockService, schedulesService, budgetService);
  const { agents, redis: agentsRedis } = buildTestAgentIdentitiesService(db);
  const runner = buildTestProcurementAgentRunner(db, agents, procurementNeedsService, lifecycleService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await procurementRedis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
    await agentsRedis.quit();
  });

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function signUpCompanyWithActiveProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `proc-agent-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `ProcAgent ${label} ${suffix}`,
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
  // own authorization gate) plus procurement.po.create/update (draft +
  // submit) — the same permissions a human calling the equivalent endpoints
  // would need.
  async function createAgentRole(tenantId: string, ownerId: string, name: string) {
    return withTenant(db, tenantId, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId, name, createdBy: ownerId }).returning();
      await tx.insert(rolePermissions).values([
        { tenantId, roleId: role!.id, permissionKey: "schedule.read" },
        { tenantId, roleId: role!.id, permissionKey: "procurement.po.create" },
        { tenantId, roleId: role!.id, permissionKey: "procurement.po.update" },
      ]);
      return role!;
    });
  }

  async function setUpResolvableNeed(tenantId: string, ownerId: string, projectId: string, costCodeSuffix: string) {
    const budget = await budgetService.create(tenantId, ownerId, projectId, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, projectId, {
      code: `PA-${costCodeSuffix}`,
      name: `Procurement agent ${costCodeSuffix}`,
      kind: "other",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "900.00" });

    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, projectId);
    await activitiesService.create(tenantId, ownerId, schedule.id, {
      name: `${costCodeSuffix} work`,
      durationDays: 2,
      costCodeId: costCode.id,
    });
    await recalculateService.recalculate(tenantId, ownerId, schedule.id);

    // A prior (now-cancelled) PO gives draftFromNeeds a historical supplier
    // to resolve, same setup as procurement.spec.ts's "draft-needs" test.
    const supplier = await suppliersService.create(tenantId, ownerId, { name: `Agent Supplier ${costCodeSuffix}` });
    const priorPo = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId,
      supplierId: supplier.id,
      lines: [{ description: "Prior buy", costCodeId: costCode.id, qtyOrdered: "1.000", uom: "LS", unitCostAmount: "10.0000" }],
    });
    await lifecycleService.cancel(tenantId, ownerId, priorPo.id);

    return { costCode, supplier };
  }

  async function outboxRowsFor(tenantId: string, eventType: string) {
    return withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    ).then((rows) => rows.filter((r) => r.eventType === eventType));
  }

  it("drafts and submits a PO on an active project, attributed to the agent as actor_type='ai'", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithActiveProject("happy");
    await setUpResolvableNeed(tenantId, ownerId, project.id, "H");
    const role = await createAgentRole(tenantId, ownerId, "Procurement Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Procurement Agent",
      purpose: "Watches schedule/stock and drafts+routes POs for human approval.",
      roleId: role.id,
      toolAllowlist: ["draft_and_route_purchase_orders"],
    });

    await runner.runTick();

    const purchaseOrders = await purchaseOrdersService.list(tenantId, { limit: 20 });
    const drafted = purchaseOrders.data.find((po) => po.projectId === project.id);
    expect(drafted).toBeDefined();
    expect(drafted!.status).toBe("pending_approval"); // submitted, not left in draft — "routed"

    const createdEvents = await outboxRowsFor(tenantId, "purchase_order.created.v1");
    const createdEvent = createdEvents.find(
      (e) => (e.payload as { purchaseOrderId: string }).purchaseOrderId === drafted!.id,
    );
    expect(createdEvent?.actorId).toBe(agent.userId);
    expect(createdEvent?.actorType).toBe("ai");

    const updatedEvents = await outboxRowsFor(tenantId, "purchase_order.updated.v1");
    const submitEvent = updatedEvents.find(
      (e) => (e.payload as { purchaseOrderId: string }).purchaseOrderId === drafted!.id,
    );
    expect(submitEvent?.actorId).toBe(agent.userId);
    expect(submitEvent?.actorType).toBe("ai");
  });

  it("ignores a project that isn't active (still in planning)", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `proc-agent-planning-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `ProcAgent Planning ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const tenantId = signUp.companyId;
    // Deliberately left in the default 'planning' status.
    const project = await projectsService.create(tenantId, ownerId, {
      name: "Planning Project",
      code: "PLAN-1",
      currency: "USD",
      contractValueAmount: "500000.00",
    });
    await setUpResolvableNeed(tenantId, ownerId, project.id, "P");
    const role = await createAgentRole(tenantId, ownerId, "Procurement Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Procurement Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["draft_and_route_purchase_orders"],
    });

    await runner.runTick();

    // setUpResolvableNeed already leaves one *cancelled* PO on this project
    // (the historical-supplier fixture) — assert no new (non-cancelled) one
    // was drafted, not that the project has zero POs at all.
    const purchaseOrders = await purchaseOrdersService.list(tenantId, { limit: 20 });
    expect(
      purchaseOrders.data.find((po) => po.projectId === project.id && po.status !== "cancelled"),
    ).toBeUndefined();
  });

  it("skips a paused agent (kill-switch) without erroring the whole tick", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithActiveProject("paused");
    await setUpResolvableNeed(tenantId, ownerId, project.id, "K");
    const role = await createAgentRole(tenantId, ownerId, "Procurement Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Procurement Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["draft_and_route_purchase_orders"],
    });
    await agents.pause(tenantId, ownerId, agent.id);

    await expect(runner.runTick()).resolves.toBeUndefined();

    const purchaseOrders = await purchaseOrdersService.list(tenantId, { limit: 20 });
    expect(
      purchaseOrders.data.find((po) => po.projectId === project.id && po.status !== "cancelled"),
    ).toBeUndefined();
  });
});
