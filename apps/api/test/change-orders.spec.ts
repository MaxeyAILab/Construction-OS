import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { buildTestChangeOrderServices } from "./setup/change-orders";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";

describe("Change Orders", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { changeOrdersService, lifecycleService, redis: sharesRedis } = buildTestChangeOrderServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await sharesRedis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `co-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `CO ${label} ${suffix}`,
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

  it("creates a change order with auto-numbering and recomputes cost_impact_amount from lines", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("crud");
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });

    const co = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "Additional excavation",
      priceImpactAmount: "5500.00",
      scheduleImpactDays: 3,
      lines: [{ costCodeId: costCode.id, description: "Excavation", costImpactAmount: "5000.00" }],
    });
    expect(co.number).toBe(1);
    expect(co.status).toBe("draft");
    expect(co.costImpactAmount).toBe("5000.00");

    const co2 = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "Second CO",
      priceImpactAmount: "100.00",
      scheduleImpactDays: 0,
      lines: [{ costCodeId: costCode.id, description: "Misc", costImpactAmount: "100.00" }],
    });
    expect(co2.number).toBe(2);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("change_order.created.v1");
  });

  it("adds/updates/deletes lines pre-submission, recomputing cost_impact_amount each time", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("lines");
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    const co = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "CO",
      priceImpactAmount: "0.00",
      scheduleImpactDays: 0,
      lines: [{ costCodeId: costCode.id, description: "A", costImpactAmount: "1000.00" }],
    });

    const line2 = await changeOrdersService.addLine(tenantId, ownerId, co.id, {
      costCodeId: costCode.id,
      description: "B",
      costImpactAmount: "500.00",
    });
    let fetched = await changeOrdersService.getById(tenantId, co.id);
    expect(fetched.costImpactAmount).toBe("1500.00");

    await changeOrdersService.updateLine(tenantId, ownerId, co.id, line2.id, { costImpactAmount: "-200.00" });
    fetched = await changeOrdersService.getById(tenantId, co.id);
    expect(fetched.costImpactAmount).toBe("800.00");

    await changeOrdersService.deleteLine(tenantId, ownerId, co.id, line2.id);
    fetched = await changeOrdersService.getById(tenantId, co.id);
    expect(fetched.lines).toHaveLength(1);
    expect(fetched.costImpactAmount).toBe("1000.00");
  });

  it("rejects header/line edits once no longer a draft (illegal_transition)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("illegal");
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    const co = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "CO",
      priceImpactAmount: "0.00",
      scheduleImpactDays: 0,
      lines: [{ costCodeId: costCode.id, description: "A", costImpactAmount: "100.00" }],
    });
    await lifecycleService.submitToClient(tenantId, ownerId, co.id);

    await expect(
      changeOrdersService.updateHeader(tenantId, ownerId, co.id, { title: "Renamed" }),
    ).rejects.toThrow(/no longer a draft/);

    await expect(lifecycleService.approve(tenantId, ownerId, co.id)).rejects.toThrow(
      /no active budget/,
    );
  });

  it("submit -> approve propagates to budget_lines.approved_changes_amount, creating a line when none exists", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("approve");
    await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });

    const co = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "New scope",
      priceImpactAmount: "5500.00",
      scheduleImpactDays: 5,
      lines: [{ costCodeId: costCode.id, description: "Extra work", costImpactAmount: "5000.00" }],
    });
    await lifecycleService.submitToClient(tenantId, ownerId, co.id);

    const approved = await lifecycleService.approve(tenantId, ownerId, co.id);
    expect(approved.status).toBe("approved");
    // internal approve doesn't claim to be the client
    expect(approved.clientApprovedBy).toBeNull();

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    expect(budgetAfter.revisedTotalAmount).toBe("5000.00");
    const line = budgetAfter.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.originalAmount).toBe("0.00");
    expect(line.approvedChangesAmount).toBe("5000.00");
    expect(line.revisedAmount).toBe("5000.00");
    expect(line.forecastAtCompletionAmount).toBe("5000.00");

    // A second CO against the same cost code accumulates onto the existing line.
    const co2 = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "More scope",
      priceImpactAmount: "1100.00",
      scheduleImpactDays: 0,
      lines: [{ costCodeId: costCode.id, description: "More work", costImpactAmount: "1000.00" }],
    });
    await lifecycleService.submitToClient(tenantId, ownerId, co2.id);
    await lifecycleService.approve(tenantId, ownerId, co2.id);

    const budgetAfter2 = await budgetService.getByProject(tenantId, project.id);
    const line2 = budgetAfter2.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line2.approvedChangesAmount).toBe("6000.00");
    expect(budgetAfter2.revisedTotalAmount).toBe("6000.00");

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("change_order.approved.v1");
    expect(eventTypes).toContain("budget_line.updated.v1");
  });

  it("rejects approving a change order that hasn't been submitted", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("notsubmitted");
    await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    const co = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "CO",
      priceImpactAmount: "0.00",
      scheduleImpactDays: 0,
      lines: [{ costCodeId: costCode.id, description: "A", costImpactAmount: "100.00" }],
    });

    await expect(lifecycleService.approve(tenantId, ownerId, co.id)).rejects.toThrow(
      /has not been submitted/,
    );
  });

  it("reject and void transitions work and are terminal", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("rejectvoid");
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });

    const co = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "CO to reject",
      priceImpactAmount: "0.00",
      scheduleImpactDays: 0,
      lines: [{ costCodeId: costCode.id, description: "A", costImpactAmount: "100.00" }],
    });
    await lifecycleService.submitToClient(tenantId, ownerId, co.id);
    const rejected = await lifecycleService.reject(tenantId, ownerId, co.id);
    expect(rejected.status).toBe("rejected");

    const co2 = await changeOrdersService.create(tenantId, ownerId, project.id, {
      title: "CO to void",
      priceImpactAmount: "0.00",
      scheduleImpactDays: 0,
      lines: [{ costCodeId: costCode.id, description: "A", costImpactAmount: "100.00" }],
    });
    const voided = await lifecycleService.void(tenantId, ownerId, co2.id);
    expect(voided.status).toBe("void");
  });

  it("RLS: a tenant only sees its own change orders", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const costCode = await costCodesService.create(a.tenantId, a.ownerId, a.project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    await changeOrdersService.create(a.tenantId, a.ownerId, a.project.id, {
      title: "CO",
      priceImpactAmount: "0.00",
      scheduleImpactDays: 0,
      lines: [{ costCodeId: costCode.id, description: "A", costImpactAmount: "100.00" }],
    });

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.changeOrders.findMany());
    expect(rowsB).toHaveLength(0);
  });
});
