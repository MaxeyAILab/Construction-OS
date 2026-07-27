import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestEquipmentServices } from "./setup/equipment";
import { buildTestProjectServices } from "./setup/projects";

// M11 Equipment (FR-EQ-1..3, database.md §13, api.md §11).
describe("Equipment", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { equipmentService, assignmentsService, usageLogsService, maintenanceService, insightsService } =
    buildTestEquipmentServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `eq-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Eq ${label} ${suffix}`,
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

  it("creates equipment with a unique asset number and rejects a duplicate", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("registry");
    const dozer = await equipmentService.create(tenantId, ownerId, {
      assetNo: "DZ-100",
      name: "D6 Dozer",
      hourlyCostRateAmount: "120.00",
    });
    expect(dozer.status).toBe("available");

    await expect(
      equipmentService.create(tenantId, ownerId, { assetNo: "DZ-100", name: "Duplicate" }),
    ).rejects.toThrow(/already exists/);
  });

  it("assigning equipment marks it 'assigned' and rejects an overlapping assignment with 409 overlap (FR-EQ-1)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("overlap");
    const project2 = await projectsService.create(tenantId, ownerId, {
      name: "Second Project",
      code: "SEC-1",
      currency: "USD",
      contractValueAmount: "500000.00",
    });
    const excavator = await equipmentService.create(tenantId, ownerId, { assetNo: "EX-200", name: "Excavator" });

    const assignment = await assignmentsService.create(tenantId, ownerId, excavator.id, { projectId: project.id });
    const updated = await equipmentService.getById(tenantId, excavator.id);
    expect(updated.status).toBe("assigned");
    expect(updated.currentProjectId).toBe(project.id);

    await expect(
      assignmentsService.create(tenantId, ownerId, excavator.id, { projectId: project2.id }),
    ).rejects.toMatchObject({ code: "overlap", status: 409 });

    await assignmentsService.end(tenantId, ownerId, excavator.id, assignment.id);
    const released = await equipmentService.getById(tenantId, excavator.id);
    expect(released.status).toBe("available");
    expect(released.currentProjectId).toBeNull();

    await expect(assignmentsService.end(tenantId, ownerId, excavator.id, assignment.id)).rejects.toThrow(/already ended/);
  });

  it("allows a non-overlapping assignment for the same equipment once the first ends", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("re-assign");
    const project2 = await projectsService.create(tenantId, ownerId, {
      name: "Third Project",
      code: "THIRD-1",
      currency: "USD",
      contractValueAmount: "250000.00",
    });
    const loader = await equipmentService.create(tenantId, ownerId, { assetNo: "LD-300", name: "Loader" });

    const first = await assignmentsService.create(tenantId, ownerId, loader.id, { projectId: project.id });
    await assignmentsService.end(tenantId, ownerId, loader.id, first.id);

    const second = await assignmentsService.create(tenantId, ownerId, loader.id, { projectId: project2.id });
    expect(second.projectId).toBe(project2.id);
  });

  it("logging hours against a project/cost code posts a job cost at the equipment's hourly rate (FR-EQ-2)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("usage");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "02",
      name: "Earthwork",
      kind: "equipment",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "5000.00" });
    const excavator = await equipmentService.create(tenantId, ownerId, {
      assetNo: "EX-400",
      name: "Excavator",
      hourlyCostRateAmount: "150.00",
    });

    await usageLogsService.create(tenantId, ownerId, excavator.id, {
      projectId: project.id,
      costCodeId: costCode.id,
      workDate: "2026-07-01",
      hours: "6.50",
    });

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    const line = budgetAfter.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.actualAmount).toBe("975.00");
  });

  it("logging hours without a project/cost code does not post a job cost", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("yard-use");
    const generator = await equipmentService.create(tenantId, ownerId, {
      assetNo: "GEN-500",
      name: "Generator",
      hourlyCostRateAmount: "40.00",
    });

    const log = await usageLogsService.create(tenantId, ownerId, generator.id, {
      workDate: "2026-07-02",
      hours: "3.00",
    });
    expect(log.projectId).toBeNull();
  });

  it("computes maintenance due-state and rolls the schedule forward on work order completion (FR-EQ-3)", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("maintenance");
    const truck = await equipmentService.create(tenantId, ownerId, { assetNo: "TR-600", name: "Dump Truck" });

    const schedule = await maintenanceService.createSchedule(tenantId, ownerId, truck.id, {
      name: "Oil change",
      recurrenceType: "days",
      recurrenceValue: 30,
      lastServiceDate: "2026-06-01",
    });

    const [scheduleWithState] = await maintenanceService.listSchedules(tenantId, truck.id);
    expect(scheduleWithState!.dueState).toBe("overdue");

    const workOrder = await maintenanceService.createWorkOrder(tenantId, ownerId, truck.id, {
      maintenanceScheduleId: schedule.id,
      description: "Perform oil change",
    });
    expect(workOrder.status).toBe("open");

    const completed = await maintenanceService.updateWorkOrder(tenantId, ownerId, truck.id, workOrder.id, {
      status: "completed",
    });
    expect(completed.completedAt).not.toBeNull();

    const [rolledForward] = await maintenanceService.listSchedules(tenantId, truck.id);
    expect(rolledForward!.dueState).toBe("ok");
    expect(rolledForward!.lastServiceDate).not.toBe("2026-06-01");
  });

  it("records an equipment inspection", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("inspection");
    const crane = await equipmentService.create(tenantId, ownerId, { assetNo: "CR-700", name: "Tower Crane" });

    const inspection = await maintenanceService.createInspection(tenantId, ownerId, crane.id, {
      inspectionDate: "2026-07-10",
      passed: false,
      notes: "Hydraulic leak observed",
    });
    expect(inspection.passed).toBe(false);

    const inspections = await maintenanceService.listInspections(tenantId, crane.id);
    expect(inspections).toHaveLength(1);
  });

  it("enforces tenant isolation for equipment", async () => {
    const { tenantId: tenantA, ownerId: ownerA } = await signUpCompanyWithProject("iso-a");
    const { tenantId: tenantB } = await signUpCompanyWithProject("iso-b");
    const equipment = await equipmentService.create(tenantA, ownerA, { assetNo: "ISO-1", name: "Isolated" });

    await expect(equipmentService.getById(tenantB, equipment.id)).rejects.toThrow(/not found/);
  });

  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  // Equipment AI insights (FR-EQ-4, api.md §11 "GET /equipment/ai/insights").
  describe("Equipment AI insights", () => {
    it("flags an available asset with no recent usage as idle, suggesting reassignment for owned equipment", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("idle-owned");
      const dozer = await equipmentService.create(tenantId, ownerId, { assetNo: "IDLE-1", name: "Idle Dozer" });
      await usageLogsService.create(tenantId, ownerId, dozer.id, { workDate: daysAgo(10), hours: "4.00" });

      const { insights } = await insightsService.listInsights(tenantId);
      const idle = insights.find((i) => i.kind === "idle_asset" && i.equipmentId === dozer.id);
      expect(idle).toBeDefined();
      expect(idle!.idleDays).toBeGreaterThanOrEqual(8);
      expect(idle!.suggestedAction).toBe("reassign");
    });

    it("does not flag an asset used within the idle threshold", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("active");
      const loader = await equipmentService.create(tenantId, ownerId, { assetNo: "ACTIVE-1", name: "Active Loader" });
      await usageLogsService.create(tenantId, ownerId, loader.id, { workDate: daysAgo(1), hours: "8.00" });

      const { insights } = await insightsService.listInsights(tenantId);
      expect(insights.some((i) => i.kind === "idle_asset" && i.equipmentId === loader.id)).toBe(false);
    });

    it("suggests returning an idle rented asset instead of reassigning", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("idle-rented");
      const rentedGen = await equipmentService.create(tenantId, ownerId, {
        assetNo: "RENT-IDLE-1",
        name: "Rented Generator",
        ownership: "rented",
      });
      await usageLogsService.create(tenantId, ownerId, rentedGen.id, { workDate: daysAgo(14), hours: "2.00" });

      const { insights } = await insightsService.listInsights(tenantId);
      const idle = insights.find((i) => i.kind === "idle_asset" && i.equipmentId === rentedGen.id);
      expect(idle!.suggestedAction).toBe("return");
    });

    it("surfaces due-soon/overdue maintenance schedules, reusing FR-EQ-3's due-state projection", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("insights-maintenance");
      const truck = await equipmentService.create(tenantId, ownerId, { assetNo: "MAINT-1", name: "Service Truck" });
      await maintenanceService.createSchedule(tenantId, ownerId, truck.id, {
        name: "Oil change",
        recurrenceType: "days",
        recurrenceValue: 30,
        lastServiceDate: "2026-06-01",
      });

      const { insights } = await insightsService.listInsights(tenantId);
      const due = insights.find((i) => i.kind === "maintenance_due" && i.equipmentId === truck.id);
      expect(due).toBeDefined();
      expect(due!.dueState).toBe("overdue");
    });

    it("recommends buying a heavily-utilized rented asset and returning a barely-used leased one", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("rent-vs-buy");
      const heavilyUsed = await equipmentService.create(tenantId, ownerId, {
        assetNo: "RVB-HIGH",
        name: "Compactor",
        ownership: "rented",
      });
      const barelyUsed = await equipmentService.create(tenantId, ownerId, {
        assetNo: "RVB-LOW",
        name: "Generator",
        ownership: "leased",
      });
      await usageLogsService.create(tenantId, ownerId, heavilyUsed.id, { workDate: daysAgo(2), hours: "200.00" });
      await usageLogsService.create(tenantId, ownerId, barelyUsed.id, { workDate: daysAgo(2), hours: "10.00" });

      const { insights } = await insightsService.listInsights(tenantId);
      const high = insights.find((i) => i.kind === "rent_vs_buy" && i.equipmentId === heavilyUsed.id);
      const low = insights.find((i) => i.kind === "rent_vs_buy" && i.equipmentId === barelyUsed.id);
      expect(high!.recommendation).toBe("consider_buying");
      expect(low!.recommendation).toBe("consider_returning");
    });

    it("does not produce rent-vs-buy insights for owned equipment", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("owned-no-rvb");
      const owned = await equipmentService.create(tenantId, ownerId, { assetNo: "OWN-1", name: "Owned Dozer" });

      const { insights } = await insightsService.listInsights(tenantId);
      expect(insights.some((i) => i.kind === "rent_vs_buy" && i.equipmentId === owned.id)).toBe(false);
    });

    it("enforces tenant isolation for equipment insights", async () => {
      const { tenantId: tenantA, ownerId: ownerA } = await signUpCompanyWithProject("insights-iso-a");
      const { tenantId: tenantB } = await signUpCompanyWithProject("insights-iso-b");
      const dozer = await equipmentService.create(tenantA, ownerA, { assetNo: "ISO-INSIGHT-1", name: "Isolated Dozer" });
      await usageLogsService.create(tenantA, ownerA, dozer.id, { workDate: daysAgo(20), hours: "1.00" });

      const { insights } = await insightsService.listInsights(tenantB);
      expect(insights.some((i) => i.equipmentId === dozer.id)).toBe(false);
    });
  });
});
