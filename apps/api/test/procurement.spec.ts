import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { commitments, outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProcurementServices } from "./setup/procurement";
import { buildTestProjectServices } from "./setup/projects";

// M5 Procurement & Purchasing (FR-PROC-1..4, database.md §12, api.md §11).
describe("Procurement & Purchasing", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { suppliersService, purchaseOrdersService, lifecycleService, rfqsService, deliveriesService } =
    buildTestProcurementServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `proc-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Proc ${label} ${suffix}`,
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
    const rows = await withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }));
    return rows.map((r) => r.eventType);
  }

  it("creates a supplier, searchable by name", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("suppliers");
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Ridgeline Building Supply" });
    expect(supplier.status).toBe("active");

    const { data } = await suppliersService.list(tenantId, { q: "Ridgeline", limit: 20 });
    expect(data.map((s) => s.id)).toContain(supplier.id);
  });

  it("creates a purchase order with auto-numbering and recomputes total_amount from lines", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("po-crud");
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Acme Lumber" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "01", name: "GC", kind: "other" });

    const po = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplier.id,
      lines: [{ description: "2x4 lumber", costCodeId: costCode.id, qtyOrdered: "100.000", uom: "ea", unitCostAmount: "5.5000" }],
    });
    expect(po.number).toBe(1);
    expect(po.status).toBe("draft");
    expect(po.totalAmount).toBe("550.00");

    const line2 = await purchaseOrdersService.addLine(tenantId, ownerId, po.id, {
      description: "Plywood",
      costCodeId: costCode.id,
      qtyOrdered: "10.000",
      uom: "ea",
      unitCostAmount: "20.0000",
    });
    let fetched = await purchaseOrdersService.getById(tenantId, po.id);
    expect(fetched.totalAmount).toBe("750.00");

    await purchaseOrdersService.deleteLine(tenantId, ownerId, po.id, line2.id);
    fetched = await purchaseOrdersService.getById(tenantId, po.id);
    expect(fetched.totalAmount).toBe("550.00");

    const events = await outboxEventTypes(tenantId);
    expect(events).toContain("purchase_order.created.v1");
  });

  it("rejects header/line edits once no longer a draft (illegal_transition)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("po-illegal");
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Acme Lumber" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "01", name: "GC", kind: "other" });
    const po = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplier.id,
      lines: [{ description: "Steel", costCodeId: costCode.id, qtyOrdered: "5.000", uom: "ea", unitCostAmount: "100.0000" }],
    });
    await lifecycleService.submit(tenantId, ownerId, po.id);

    await expect(purchaseOrdersService.updateHeader(tenantId, ownerId, po.id, { shipTo: "Site" })).rejects.toThrow(
      /no longer a draft/,
    );
    await expect(lifecycleService.approve(tenantId, ownerId, po.id)).rejects.toThrow(/no active budget/);
  });

  it("submit -> approve writes a commitment and bumps budget_lines.committed_amount (FR-PROC-3)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("po-approve");
    await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Acme Lumber" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "01", name: "GC", kind: "other" });

    const po = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplier.id,
      lines: [{ description: "Steel", costCodeId: costCode.id, qtyOrdered: "10.000", uom: "ea", unitCostAmount: "250.0000" }],
    });
    await lifecycleService.submit(tenantId, ownerId, po.id);
    const approved = await lifecycleService.approve(tenantId, ownerId, po.id);
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(ownerId);

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    const line = budgetAfter.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.committedAmount).toBe("2500.00");

    const events = await outboxEventTypes(tenantId);
    expect(events).toContain("purchase_order.approved.v1");
  });

  it("cancelling an approved PO reverses its commitment and budget_lines.committed_amount", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("po-cancel");
    await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Acme Lumber" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "01", name: "GC", kind: "other" });

    const po = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplier.id,
      lines: [{ description: "Steel", costCodeId: costCode.id, qtyOrdered: "4.000", uom: "ea", unitCostAmount: "100.0000" }],
    });
    await lifecycleService.submit(tenantId, ownerId, po.id);
    await lifecycleService.approve(tenantId, ownerId, po.id);

    const cancelled = await lifecycleService.cancel(tenantId, ownerId, po.id);
    expect(cancelled.status).toBe("cancelled");

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    const line = budgetAfter.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.committedAmount).toBe("0.00");

    const activeCommitments = await withTenant(db, tenantId, (tx) =>
      tx.query.commitments.findMany({ where: eq(commitments.sourceId, po.id) }),
    );
    expect(activeCommitments.every((c) => c.status === "cancelled")).toBe(true);
  });

  it("creates an RFQ with lines and records a supplier quote against a line", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("rfq");
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Acme Lumber" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "01", name: "GC", kind: "other" });

    const rfq = await rfqsService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Structural steel RFQ",
      lines: [{ description: "W12x26 beams", costCodeId: costCode.id, qty: "50.000", uom: "ft" }],
    });
    expect(rfq.number).toBe(1);
    expect(rfq.lines).toHaveLength(1);

    const quote = await rfqsService.createQuote(tenantId, ownerId, rfq.id, {
      rfqLineId: rfq.lines[0]!.id,
      supplierId: supplier.id,
      unitCostAmount: "42.5000",
      leadTimeDays: 14,
    });
    expect(quote.status).toBe("submitted");

    const quotes = await rfqsService.listQuotes(tenantId, rfq.id);
    expect(quotes.map((q) => q.id)).toContain(quote.id);
  });

  it("records a delivery against PO lines, updating qty_received and deriving partially_received/received (FR-PROC-4)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("delivery");
    await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Acme Lumber" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "01", name: "GC", kind: "other" });

    const po = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplier.id,
      lines: [{ description: "Rebar", costCodeId: costCode.id, qtyOrdered: "100.000", uom: "ea", unitCostAmount: "3.0000" }],
    });
    await lifecycleService.submit(tenantId, ownerId, po.id);
    await lifecycleService.approve(tenantId, ownerId, po.id);
    const sent = await lifecycleService.send(tenantId, ownerId, po.id);
    expect(sent.status).toBe("sent");

    const lineId = (await purchaseOrdersService.getById(tenantId, po.id)).lines[0]!.id;

    const firstDelivery = await deliveriesService.create(tenantId, ownerId, po.id, {
      deliveryDate: "2026-01-15",
      lines: [{ purchaseOrderLineId: lineId, qtyReceived: "40.000" }],
    });
    expect(firstDelivery.purchaseOrderId).toBe(po.id);
    let poAfter = await purchaseOrdersService.getById(tenantId, po.id);
    expect(poAfter.status).toBe("partially_received");
    expect(poAfter.lines[0]!.qtyReceived).toBe("40.000");

    // Over-delivery is rejected while still receivable (partially_received).
    await expect(
      deliveriesService.create(tenantId, ownerId, po.id, {
        deliveryDate: "2026-01-16",
        lines: [{ purchaseOrderLineId: lineId, qtyReceived: "65.000" }],
      }),
    ).rejects.toThrow(/exceeds/);

    await deliveriesService.create(tenantId, ownerId, po.id, {
      deliveryDate: "2026-01-20",
      lines: [{ purchaseOrderLineId: lineId, qtyReceived: "60.000" }],
    });
    poAfter = await purchaseOrdersService.getById(tenantId, po.id);
    expect(poAfter.status).toBe("received");

    // Once fully received, the PO is no longer in a receivable status.
    await expect(
      deliveriesService.create(tenantId, ownerId, po.id, {
        deliveryDate: "2026-01-21",
        lines: [{ purchaseOrderLineId: lineId, qtyReceived: "1.000" }],
      }),
    ).rejects.toThrow(/must be/);

    const deliveries = await deliveriesService.listForPurchaseOrder(tenantId, po.id);
    expect(deliveries).toHaveLength(2);
  });

  it("RLS: a tenant only sees its own suppliers and purchase orders", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const supplierA = await suppliersService.create(a.tenantId, a.ownerId, { name: "A Supplier" });
    const costCodeA = await costCodesService.create(a.tenantId, a.ownerId, a.project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    await purchaseOrdersService.create(a.tenantId, a.ownerId, {
      projectId: a.project.id,
      supplierId: supplierA.id,
      lines: [{ description: "X", costCodeId: costCodeA.id, qtyOrdered: "1.000", uom: "ea", unitCostAmount: "1.0000" }],
    });

    const { data: bSuppliers } = await suppliersService.list(b.tenantId, { limit: 20 });
    expect(bSuppliers).toHaveLength(0);
    const { data: bPOs } = await purchaseOrdersService.list(b.tenantId, { limit: 20 });
    expect(bPOs).toHaveLength(0);
  });
});
