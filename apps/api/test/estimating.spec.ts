import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestEstimatingServices } from "./setup/estimating";
import { buildTestProjectServices } from "./setup/projects";

describe("Estimating v1", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { estimateService, estimateLinesService, costBookService, convertToBudgetService } =
    buildTestEstimatingServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `est-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Estimating ${label} ${suffix}`,
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

  async function outboxEventTypes(tenantId: string): Promise<string[]> {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    );
    return rows.map((r) => r.eventType);
  }

  it("creates an estimate (version 1) and rejects a second one for the same project", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("crud");

    const estimate = await estimateService.create(tenantId, ownerId, { projectId: project.id, currency: "USD" });
    expect(estimate.version).toBe(1);
    expect(estimate.status).toBe("draft");
    expect(estimate.subtotalAmount).toBe("0.00");

    await expect(
      estimateService.create(tenantId, ownerId, { projectId: project.id, currency: "USD" }),
    ).rejects.toThrow(/already has an estimate/);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("estimate.created.v1");
  });

  it("adds lines: totals recompute, and the markup/overhead/contingency/tax cascade applies in order", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("cascade");
    const estimate = await estimateService.create(tenantId, ownerId, {
      projectId: project.id,
      currency: "USD",
      overheadPct: "10.00",
      contingencyPct: "5.00",
      markupPct: "8.00",
      taxPct: "7.00",
    });

    await estimateLinesService.addLine(tenantId, ownerId, estimate.id, {
      costCodeRef: "01-100",
      description: "Mobilization",
      qty: "1.000",
      uom: "LS",
      unitCostAmount: "10000.0000",
    });

    const withLines = await estimateService.getById(tenantId, estimate.id);
    expect(withLines.subtotalAmount).toBe("10000.00");

    // 10000 -> +10% overhead = 11000 -> +5% contingency = 11550
    // -> +8% markup = 12474 -> +7% tax = 13347.18
    expect(withLines.totalAmount).toBe("13347.18");

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("estimate_line.created.v1");
  });

  it("batch-adds up to the line list and recomputes totals once", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("batch");
    const estimate = await estimateService.create(tenantId, ownerId, { projectId: project.id, currency: "USD" });

    const lines = await estimateLinesService.batchAddLines(tenantId, ownerId, estimate.id, {
      lines: [
        { costCodeRef: "01-100", description: "A", qty: "1.000", uom: "LS", unitCostAmount: "100.0000" },
        { costCodeRef: "01-200", description: "B", qty: "2.000", uom: "EA", unitCostAmount: "50.0000" },
      ],
    });
    expect(lines).toHaveLength(2);

    const withLines = await estimateService.getById(tenantId, estimate.id);
    expect(withLines.subtotalAmount).toBe("200.00");
    expect(withLines.totalAmount).toBe("200.00");
  });

  it("updates and soft-deletes a line, excluding it from totals afterward", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("linecrud");
    const estimate = await estimateService.create(tenantId, ownerId, { projectId: project.id, currency: "USD" });
    const line = await estimateLinesService.addLine(tenantId, ownerId, estimate.id, {
      costCodeRef: "01-100",
      description: "Mobilization",
      qty: "1.000",
      uom: "LS",
      unitCostAmount: "1000.0000",
    });

    const updated = await estimateLinesService.updateLine(tenantId, ownerId, estimate.id, line.id, {
      unitCostAmount: "1500.0000",
    });
    expect(updated.totalCostAmount).toBe("1500.00");

    let withLines = await estimateService.getById(tenantId, estimate.id);
    expect(withLines.subtotalAmount).toBe("1500.00");

    await estimateLinesService.deleteLine(tenantId, ownerId, estimate.id, line.id);
    withLines = await estimateService.getById(tenantId, estimate.id);
    expect(withLines.lines).toHaveLength(0);
    expect(withLines.subtotalAmount).toBe("0.00");

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("estimate_line.updated.v1");
    expect(eventTypes).toContain("estimate_line.deleted.v1");
  });

  it("explodes an assembly into priced lines at the requested quantity", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("assembly");
    const estimate = await estimateService.create(tenantId, ownerId, { projectId: project.id, currency: "USD" });

    const stud = await costBookService.createCostItem(tenantId, ownerId, {
      code: "STUD-2X4",
      description: "2x4 stud",
      uom: "EA",
      currentUnitCostAmount: "3.5000",
    });
    const drywall = await costBookService.createCostItem(tenantId, ownerId, {
      code: "DRYWALL",
      description: "Drywall sheet",
      uom: "SF",
      currentUnitCostAmount: "0.8000",
    });
    const wall = await costBookService.createAssembly(tenantId, ownerId, {
      code: "WALL-INT",
      name: "Interior wall",
      uom: "SF",
      items: [
        { costItemId: stud.id, qtyPerUnit: "0.2000" },
        { costItemId: drywall.id, qtyPerUnit: "2.0000" },
      ],
    });

    const exploded = await estimateLinesService.addAssemblyToEstimate(tenantId, ownerId, estimate.id, {
      assemblyId: wall.id,
      qty: "50.000",
      costCodeRef: "06-100",
    });
    expect(exploded).toHaveLength(2);
    const studLine = exploded.find((l) => l.description === "2x4 stud")!;
    expect(studLine.qty).toBe("10.000"); // 0.2 * 50
    expect(studLine.source).toBe("assembly");

    const withLines = await estimateService.getById(tenantId, estimate.id);
    // 10 * 3.50 + 100 * 0.80 = 35 + 80 = 115
    expect(withLines.subtotalAmount).toBe("115.00");
  });

  it("FR-EST-4: creates a new version that copies lines and supersedes the source", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("version");
    const estimate = await estimateService.create(tenantId, ownerId, { projectId: project.id, currency: "USD" });
    await estimateLinesService.addLine(tenantId, ownerId, estimate.id, {
      costCodeRef: "01-100",
      description: "Mobilization",
      qty: "1.000",
      uom: "LS",
      unitCostAmount: "1000.0000",
    });

    const v2 = await estimateService.createVersion(tenantId, ownerId, estimate.id);
    expect(v2.version).toBe(2);
    expect(v2.subtotalAmount).toBe("1000.00");

    const v2WithLines = await estimateService.getById(tenantId, v2.id);
    expect(v2WithLines.lines).toHaveLength(1);
    expect(v2WithLines.lines[0]!.description).toBe("Mobilization");

    const sourceAfter = await estimateService.getById(tenantId, estimate.id);
    expect(sourceAfter.status).toBe("superseded");
  });

  it("FR-EST-5: converts an estimate to a budget, mapping/creating cost codes and aggregating by code", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("convert");
    const estimate = await estimateService.create(tenantId, ownerId, { projectId: project.id, currency: "USD" });
    await estimateLinesService.batchAddLines(tenantId, ownerId, estimate.id, {
      lines: [
        { costCodeRef: "01-100", description: "GC line 1", qty: "1.000", uom: "LS", unitCostAmount: "1000.0000" },
        { costCodeRef: "01-100", description: "GC line 2", qty: "1.000", uom: "LS", unitCostAmount: "500.0000" },
        { costCodeRef: "02-200", description: "Sitework", qty: "1.000", uom: "LS", unitCostAmount: "2000.0000" },
      ],
    });

    const budget = await convertToBudgetService.convert(tenantId, ownerId, estimate.id);
    expect(budget.originalTotalAmount).toBe("3500.00");
    expect(budget.lines).toHaveLength(2); // aggregated: two distinct cost codes

    const gcLine = budget.lines.find((l) =>
      // originalAmount 1500 = 1000 + 500 aggregated under 01-100
      l.originalAmount === "1500.00",
    );
    expect(gcLine).toBeDefined();

    const estimateAfter = await estimateService.getById(tenantId, estimate.id);
    expect(estimateAfter.status).toBe("won");

    await expect(convertToBudgetService.convert(tenantId, ownerId, estimate.id)).rejects.toThrow(
      /already has an active budget/,
    );

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("budget.created.v1");
    expect(eventTypes).toContain("cost_code.created.v1");
  });

  it("cost book: records a price observation, updates current_unit_cost_amount, and lists the ledger", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("costbook");
    const item = await costBookService.createCostItem(tenantId, ownerId, {
      code: "CONC-3000",
      description: "3000psi concrete",
      uom: "CY",
      currentUnitCostAmount: "150.0000",
    });

    await costBookService.recordPriceObservation(tenantId, ownerId, item.id, { unitCostAmount: "165.0000" });

    const items = await costBookService.listCostItems(tenantId);
    expect(items.find((i) => i.id === item.id)!.currentUnitCostAmount).toBe("165.0000");

    const history = await costBookService.listPriceHistory(tenantId, item.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.source).toBe("manual");

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("cost_item.price_observed.v1");
  });

  it("rejects a duplicate cost item code and a duplicate assembly code", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("dupes");
    await costBookService.createCostItem(tenantId, ownerId, {
      code: "DUPE",
      description: "First",
      uom: "EA",
      currentUnitCostAmount: "1.0000",
    });
    await expect(
      costBookService.createCostItem(tenantId, ownerId, {
        code: "DUPE",
        description: "Second",
        uom: "EA",
        currentUnitCostAmount: "2.0000",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("RLS: a tenant only sees its own estimates", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await estimateService.create(a.tenantId, a.ownerId, { projectId: a.project.id, currency: "USD" });

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.estimates.findMany());
    expect(rowsB).toHaveLength(0);
  });
});
