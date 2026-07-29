import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { commitments, outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestInventoryServices } from "./setup/inventory";
import { buildTestProcurementServices } from "./setup/procurement";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSchedulingServices } from "./setup/scheduling";

// M5 Procurement & Purchasing (FR-PROC-1..4, database.md §12, api.md §11).
describe("Procurement & Purchasing", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { stockService } = buildTestInventoryServices(db);
  const { schedulesService, activitiesService, recalculateService, queueConnection, cacheRedis } =
    buildTestSchedulingServices(db);
  const {
    suppliersService,
    supplierScoringService,
    purchaseOrdersService,
    lifecycleService,
    rfqsService,
    deliveriesService,
    procurementNeedsService,
    redis: procurementRedis,
  } = buildTestProcurementServices(db, stockService, schedulesService, budgetService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await procurementRedis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
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
    let fetched = await purchaseOrdersService.getById(tenantId, ownerId, po.id);
    expect(fetched.totalAmount).toBe("750.00");

    await purchaseOrdersService.deleteLine(tenantId, ownerId, po.id, line2.id);
    fetched = await purchaseOrdersService.getById(tenantId, ownerId, po.id);
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

    const lineId = (await purchaseOrdersService.getById(tenantId, ownerId, po.id)).lines[0]!.id;

    const firstDelivery = await deliveriesService.create(tenantId, ownerId, po.id, {
      deliveryDate: "2026-01-15",
      lines: [{ purchaseOrderLineId: lineId, qtyReceived: "40.000" }],
    });
    expect(firstDelivery.purchaseOrderId).toBe(po.id);
    let poAfter = await purchaseOrdersService.getById(tenantId, ownerId, po.id);
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
    poAfter = await purchaseOrdersService.getById(tenantId, ownerId, po.id);
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

  it("FR-PROC-5: buy-timing feed surfaces an overdue, historically-priced need and skips a cost code already covered by an open PO", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("needs");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCodeA = await costCodesService.create(tenantId, ownerId, project.id, { code: "A", name: "Needs A", kind: "other" });
    const costCodeB = await costCodesService.create(tenantId, ownerId, project.id, { code: "B", name: "Needs B", kind: "other" });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCodeA.id, originalAmount: "5000.00" });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCodeB.id, originalAmount: "5000.00" });

    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Need A work", durationDays: 5, costCodeId: costCodeA.id });
    await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Need B work", durationDays: 3, costCodeId: costCodeB.id });
    await recalculateService.recalculate(tenantId, ownerId, schedule.id);

    // Cost code A: a cancelled PO still leaves a supplier trail to learn from.
    const supplierA = await suppliersService.create(tenantId, ownerId, { name: "Historical Supplier A", defaultLeadTimeDays: 10 });
    const poA = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplierA.id,
      lines: [{ description: "Prior buy", costCodeId: costCodeA.id, qtyOrdered: "1.000", uom: "LS", unitCostAmount: "100.0000" }],
    });
    await lifecycleService.cancel(tenantId, ownerId, poA.id);

    // Cost code B: an open (draft) PO already covers it — must be excluded.
    const supplierB = await suppliersService.create(tenantId, ownerId, { name: "Supplier B" });
    await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplierB.id,
      lines: [{ description: "Already covering B", costCodeId: costCodeB.id, qtyOrdered: "1.000", uom: "LS", unitCostAmount: "50.0000" }],
    });

    const needs = await procurementNeedsService.computeNeeds(tenantId, ownerId, project.id);
    expect(needs).toHaveLength(1);
    const need = needs[0]!;
    expect(need.costCodeId).toBe(costCodeA.id);
    expect(need.supplierId).toBe(supplierA.id);
    expect(need.leadTimeDays).toBe(10);
    expect(need.remainingBudgetAmount).toBe("5000.00");
    // needByDate = schedule.dataDate (today, no predecessors) minus a
    // 10-day lead time and 5-day buffer puts the order-by date well in
    // the past.
    expect(need.riskLevel).toBe("overdue");
    expect(need.daysUntilMustOrder).toBeLessThan(0);
  });

  // ai-spec.md §7.4 "delivery-risk alerts (promised vs need dates)" — the
  // complement of the buy-timing feed above: these are cost codes that DO
  // already have an open PO, so computeNeeds skips them entirely.
  it("FR-VEND-3: flags a PO promised after its need date, an unconfirmed PO with an imminent need date, and clears once received", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("delivery-risk");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCodeLate = await costCodesService.create(tenantId, ownerId, project.id, { code: "L", name: "Late", kind: "other" });
    const costCodeNoPromise = await costCodesService.create(tenantId, ownerId, project.id, { code: "N", name: "NoPromise", kind: "other" });
    const costCodeReceived = await costCodesService.create(tenantId, ownerId, project.id, { code: "R", name: "Received", kind: "other" });
    for (const cc of [costCodeLate, costCodeNoPromise, costCodeReceived]) {
      await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: cc.id, originalAmount: "5000.00" });
    }

    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Late work", durationDays: 5, costCodeId: costCodeLate.id });
    await activitiesService.create(tenantId, ownerId, schedule.id, {
      name: "No-promise work",
      durationDays: 5,
      costCodeId: costCodeNoPromise.id,
    });
    await activitiesService.create(tenantId, ownerId, schedule.id, {
      name: "Received work",
      durationDays: 5,
      costCodeId: costCodeReceived.id,
    });
    await recalculateService.recalculate(tenantId, ownerId, schedule.id);
    // No predecessors -> every activity's need date is the schedule's own data date (today).
    const needByDate = new Date().toISOString().slice(0, 10);

    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Delivery Risk Supplier" });

    async function createSentPo(costCodeId: string) {
      const po = await purchaseOrdersService.create(tenantId, ownerId, {
        projectId: project.id,
        supplierId: supplier.id,
        lines: [{ description: "Committed buy", costCodeId, qtyOrdered: "1.000", uom: "LS", unitCostAmount: "50.0000" }],
      });
      await lifecycleService.submit(tenantId, ownerId, po.id);
      await lifecycleService.approve(tenantId, ownerId, po.id);
      await lifecycleService.send(tenantId, ownerId, po.id);
      return po;
    }

    const latePo = await createSentPo(costCodeLate.id);
    const tenDaysOut = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await lifecycleService.confirm(tenantId, ownerId, latePo.id, { promisedDate: tenDaysOut });

    await createSentPo(costCodeNoPromise.id); // sent, never confirmed -> no promised date on file

    const receivedPo = await createSentPo(costCodeReceived.id);
    const farOut = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await lifecycleService.confirm(tenantId, ownerId, receivedPo.id, { promisedDate: farOut });
    await deliveriesService.create(tenantId, ownerId, receivedPo.id, {
      deliveryDate: needByDate,
      lines: [{ purchaseOrderLineId: (await purchaseOrdersService.getById(tenantId, ownerId, receivedPo.id)).lines[0]!.id, qtyReceived: "1.000" }],
    });

    const risks = await procurementNeedsService.computeDeliveryRisks(tenantId, ownerId, project.id);
    expect(risks).toHaveLength(2);

    const lateRisk = risks.find((r) => r.costCodeId === costCodeLate.id)!;
    expect(lateRisk.reason).toBe("promised_after_need_date");
    expect(lateRisk.promisedDate).toBe(tenDaysOut);
    expect(lateRisk.daysLate).toBe(10);
    expect(lateRisk.purchaseOrderId).toBe(latePo.id);

    const noPromiseRisk = risks.find((r) => r.costCodeId === costCodeNoPromise.id)!;
    expect(noPromiseRisk.reason).toBe("no_promised_date");
    expect(noPromiseRisk.promisedDate).toBeNull();
    expect(noPromiseRisk.daysLate).toBeNull();

    expect(risks.some((r) => r.costCodeId === costCodeReceived.id)).toBe(false);
  });

  it("FR-PROC-6: drafts a real PO for a resolvable need and reports an unresolvable one as skipped", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("draft-needs");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCodeA = await costCodesService.create(tenantId, ownerId, project.id, { code: "A", name: "Resolvable", kind: "other" });
    const costCodeC = await costCodesService.create(tenantId, ownerId, project.id, { code: "C", name: "Unresolvable", kind: "other" });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCodeA.id, originalAmount: "1200.00" });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCodeC.id, originalAmount: "800.00" });

    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    await activitiesService.create(tenantId, ownerId, schedule.id, { name: "A work", durationDays: 2, costCodeId: costCodeA.id });
    await activitiesService.create(tenantId, ownerId, schedule.id, { name: "C work", durationDays: 2, costCodeId: costCodeC.id });
    await recalculateService.recalculate(tenantId, ownerId, schedule.id);

    const supplierA = await suppliersService.create(tenantId, ownerId, { name: "Draftable Supplier" });
    const priorPo = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplierA.id,
      lines: [{ description: "Prior buy", costCodeId: costCodeA.id, qtyOrdered: "1.000", uom: "LS", unitCostAmount: "10.0000" }],
    });
    await lifecycleService.cancel(tenantId, ownerId, priorPo.id);
    // costCodeC has no PO history at all — no supplier can be resolved.

    const result = await procurementNeedsService.draftFromNeeds(tenantId, ownerId, project.id);
    expect(result.draftedPurchaseOrderIds).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.costCodeId).toBe(costCodeC.id);
    expect(result.skipped[0]!.reason).toMatch(/no historical supplier/);
    expect(result.aiRunId).toBeTruthy();
    expect(result.rationale).toBeTruthy();

    const drafted = await purchaseOrdersService.getById(tenantId, ownerId, result.draftedPurchaseOrderIds[0]!);
    expect(drafted.status).toBe("draft");
    expect(drafted.supplierId).toBe(supplierA.id);
    expect(drafted.aiRunId).toBe(result.aiRunId);
    expect(drafted.lines[0]!.costCodeId).toBe(costCodeA.id);
    expect(drafted.lines[0]!.unitCostAmount).toBe("1200.0000");
  });

  it("FR-PROC-5: rescores a supplier's on-time % and price index from its own PO/delivery history", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("scoring");
    await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "SC", name: "Scoring", kind: "other" });

    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Scored Supplier" });

    async function placeAndDeliver(unitCost: string, promisedDate: string, deliveryDate: string) {
      const po = await purchaseOrdersService.create(tenantId, ownerId, {
        projectId: project.id,
        supplierId: supplier.id,
        lines: [{ description: "Line", costCodeId: costCode.id, qtyOrdered: "1.000", uom: "EA", unitCostAmount: unitCost }],
      });
      await purchaseOrdersService.updateHeader(tenantId, ownerId, po.id, { promisedDate });
      await lifecycleService.submit(tenantId, ownerId, po.id);
      await lifecycleService.approve(tenantId, ownerId, po.id);
      const sent = await lifecycleService.send(tenantId, ownerId, po.id);
      const lineId = (await purchaseOrdersService.getById(tenantId, ownerId, po.id)).lines[0]!.id;
      await deliveriesService.create(tenantId, ownerId, sent.id, { deliveryDate, lines: [{ purchaseOrderLineId: lineId, qtyReceived: "1.000" }] });
      return po;
    }

    await placeAndDeliver("10.0000", "2026-02-01", "2026-01-30"); // on time
    await placeAndDeliver("20.0000", "2026-02-01", "2026-02-05"); // late

    // A second supplier's cheaper price on the same cost code pulls the
    // tenant-wide average below this supplier's own average.
    const otherSupplier = await suppliersService.create(tenantId, ownerId, { name: "Cheaper Supplier" });
    await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: otherSupplier.id,
      lines: [{ description: "Line", costCodeId: costCode.id, qtyOrdered: "1.000", uom: "EA", unitCostAmount: "10.0000" }],
    });

    const rescored = await supplierScoringService.rescore(tenantId, ownerId, supplier.id);
    const rating = rescored.rating as { onTimePct: number; priceIndex: number; disputeCount: null };
    expect(rating.onTimePct).toBe(50);
    // tenant avg = (10+20+10)/3 = 13.333..; supplier avg = (10+20)/2 = 15
    expect(rating.priceIndex).toBeCloseTo(15 / (40 / 3), 3);
    expect(rating.disputeCount).toBeNull();

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("supplier.rated.v1");
  });

  it("rescoring a supplier with no PO/delivery history yields null scores rather than throwing", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("scoring-empty");
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Untested Supplier" });

    const rescored = await supplierScoringService.rescore(tenantId, ownerId, supplier.id);
    const rating = rescored.rating as { onTimePct: null; priceIndex: null };
    expect(rating.onTimePct).toBeNull();
    expect(rating.priceIndex).toBeNull();
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
