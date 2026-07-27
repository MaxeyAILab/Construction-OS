import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { buildTestCrmServices } from "./setup/crm";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestExternalSharesService } from "./setup/external-shares";
import { buildTestFinanceServices } from "./setup/finance";
import { buildTestInventoryServices } from "./setup/inventory";
import { buildTestProcurementServices } from "./setup/procurement";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";
import { buildTestSubcontractorServices } from "./setup/subcontractors";

// Supplier Portal (M15, FR-VEND-1..3) + Finance invoices/payments
// (database.md §11, api.md §10, FR-SUB-3 gap closure).
describe("Supplier Portal & Finance Invoices", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService, costTransactionsService } = buildTestBudgetServices(db);
  const { stockService } = buildTestInventoryServices(db);
  const {
    suppliersService,
    purchaseOrdersService,
    lifecycleService,
    deliveriesService,
    redis: procurementRedis,
  } = buildTestProcurementServices(db, stockService);
  const { contactCompaniesService } = buildTestCrmServices(db, projectsService);
  const { subcontractorsService } = buildTestSubcontractorServices(db);
  const { invoicesService, paymentsService } = buildTestFinanceServices(db, {
    purchaseOrdersService,
    suppliersService,
    subcontractorsService,
    contactCompaniesService,
    costTransactionsService,
  });
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const { externalSharesService } = buildTestExternalSharesService(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await procurementRedis.quit();
    await rbacRedis.quit();
  });

  async function signUpCompanyWithProjectAndBudget(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `finance-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Finance ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    const budget = await budgetService.create(signUp.companyId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(signUp.companyId, ownerId, project.id, {
      code: "01",
      name: "General",
      kind: "material",
    });
    await budgetService.addLine(signUp.companyId, ownerId, budget.id, {
      costCodeId: costCode.id,
      originalAmount: "50000.00",
    });
    return { tenantId: signUp.companyId, ownerId, project, budget, costCode };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function approvedSentPo(tenantId: string, ownerId: string, projectId: string, costCodeId: string, qty: string, unitCost: string) {
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Ridgeline Supply" });
    const po = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId,
      supplierId: supplier.id,
      lines: [{ description: "Lumber", costCodeId, qtyOrdered: qty, uom: "ea", unitCostAmount: unitCost }],
    });
    await lifecycleService.submit(tenantId, ownerId, po.id);
    await lifecycleService.approve(tenantId, ownerId, po.id);
    await lifecycleService.send(tenantId, ownerId, po.id);
    const withLines = await purchaseOrdersService.getById(tenantId, ownerId, po.id);
    return { supplier, po, poLine: withLines.lines[0]! };
  }

  it("3-way matches a supplier invoice against a received PO line and posts actual cost on approval (FR-VEND-2)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("3way");
    const { supplier, po, poLine } = await approvedSentPo(tenantId, ownerId, project.id, costCode.id, "10.000", "20.0000");

    await deliveriesService.create(tenantId, ownerId, po.id, {
      deliveryDate: "2026-01-15",
      lines: [{ purchaseOrderLineId: poLine.id, qtyReceived: "10.000" }],
    });

    const invoice = await invoicesService.create(tenantId, ownerId, {
      direction: "payable",
      counterpartyType: "supplier",
      counterpartyId: supplier.id,
      projectId: project.id,
      issueDate: "2026-01-20",
      lines: [
        {
          purchaseOrderLineId: poLine.id,
          costCodeId: costCode.id,
          description: "Lumber invoice",
          qty: "10.000",
          unitPriceAmount: "20.0000",
          amount: "200.00",
        },
      ],
    });
    expect(invoice.matchStatus).toBe("three_way_matched");
    expect(invoice.status).toBe("draft");

    const approved = await invoicesService.approve(tenantId, ownerId, invoice.id);
    expect(approved.status).toBe("approved");
    expect(approved.matchStatus).toBe("three_way_matched");

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    const line = budgetAfter.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.actualAmount).toBe("200.00");
  });

  it("blocks approval of a mismatched invoice (invoiced qty exceeds ordered) until corrected (FR-VEND-2)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("mismatch");
    const { supplier, poLine } = await approvedSentPo(tenantId, ownerId, project.id, costCode.id, "5.000", "20.0000");

    const invoice = await invoicesService.create(tenantId, ownerId, {
      direction: "payable",
      counterpartyType: "supplier",
      counterpartyId: supplier.id,
      projectId: project.id,
      issueDate: "2026-01-20",
      lines: [
        {
          purchaseOrderLineId: poLine.id,
          costCodeId: costCode.id,
          description: "Over-invoiced lumber",
          qty: "10.000",
          unitPriceAmount: "20.0000",
          amount: "200.00",
        },
      ],
    });
    expect(invoice.matchStatus).toBe("mismatched");

    await expect(invoicesService.approve(tenantId, ownerId, invoice.id)).rejects.toMatchObject({
      code: "mismatched",
      status: 422,
    });
  });

  it("processes a subcontractor invoice into actual costs without a PO match (FR-SUB-3)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("subinvoice");
    const sub = await subcontractorsService.create(tenantId, ownerId, { name: "Solid Concrete" });

    const invoice = await invoicesService.create(tenantId, ownerId, {
      direction: "payable",
      counterpartyType: "subcontractor",
      counterpartyId: sub.id,
      projectId: project.id,
      issueDate: "2026-02-01",
      lines: [{ costCodeId: costCode.id, description: "Foundation progress claim", amount: "5000.00" }],
    });
    expect(invoice.matchStatus).toBeNull();

    await invoicesService.approve(tenantId, ownerId, invoice.id);

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    const line = budgetAfter.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.actualAmount).toBe("5000.00");
  });

  it("applies partial payments and flips to paid once the balance is fully covered", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("payments");
    const client = await contactCompaniesService.create(tenantId, ownerId, { name: "Acme Developers" });

    const invoice = await invoicesService.create(tenantId, ownerId, {
      direction: "receivable",
      counterpartyType: "client",
      counterpartyId: client.id,
      projectId: project.id,
      issueDate: "2026-02-01",
      lines: [{ costCodeId: costCode.id, description: "Progress billing", amount: "1000.00" }],
    });
    await invoicesService.approve(tenantId, ownerId, invoice.id);

    const partial = await paymentsService.create(tenantId, ownerId, invoice.id, { amount: "400.00", paidAt: "2026-02-05" });
    expect(partial.amount).toBe("400.00");
    let current = await invoicesService.getById(tenantId, invoice.id);
    expect(current.status).toBe("approved");
    expect(current.paidAmount).toBe("400.00");

    await expect(
      paymentsService.create(tenantId, ownerId, invoice.id, { amount: "1000.00", paidAt: "2026-02-10" }),
    ).rejects.toMatchObject({ code: "payment_exceeds_balance" });

    await paymentsService.create(tenantId, ownerId, invoice.id, { amount: "600.00", paidAt: "2026-02-10" });
    current = await invoicesService.getById(tenantId, invoice.id);
    expect(current.status).toBe("paid");
    expect(current.paidAmount).toBe("1000.00");
  });

  it("lets a supplier confirm a PO via a supplier-portal share without an internal permission (FR-VEND-1)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("confirm-share");
    const { po } = await approvedSentPo(tenantId, ownerId, project.id, costCode.id, "5.000", "20.0000");

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: supplierUserId } = await rbacService.inviteUser(
      tenantId,
      `supplier-portal-${suffix}@example.com`,
      "Supplier Contact",
      ownerId,
      "external",
    );
    await externalSharesService.create(tenantId, ownerId, {
      principalUserId: supplierUserId,
      audience: "supplier",
      entityType: "purchase_order",
      entityId: po.id,
      access: "approve",
    });

    const confirmed = await lifecycleService.confirm(tenantId, supplierUserId, po.id, { promisedDate: "2026-03-01" });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.promisedDate).toBe("2026-03-01");

    const viaShare = await externalSharesService.create(tenantId, ownerId, {
      principalUserId: supplierUserId,
      audience: "supplier",
      entityType: "purchase_order",
      entityId: po.id,
      access: "view",
    });
    expect(viaShare.access).toBe("view");
    const read = await purchaseOrdersService.getById(tenantId, supplierUserId, po.id);
    expect(read.id).toBe(po.id);
  });

  it("rejects PO confirm when the caller has neither internal permission nor a matching share", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("confirm-deny");
    const { po } = await approvedSentPo(tenantId, ownerId, project.id, costCode.id, "5.000", "20.0000");

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: bystanderId } = await rbacService.inviteUser(
      tenantId,
      `bystander-${suffix}@example.com`,
      "No Access",
      ownerId,
      "internal",
    );

    await expect(lifecycleService.confirm(tenantId, bystanderId, po.id)).rejects.toThrow(/procurement\.po\.update/);
  });

  it("enforces tenant isolation for invoices", async () => {
    const { tenantId: tenantA, ownerId: ownerA, project: projectA, costCode: costCodeA } =
      await signUpCompanyWithProjectAndBudget("iso-a");
    const { tenantId: tenantB } = await signUpCompanyWithProjectAndBudget("iso-b");
    const supplierA = await suppliersService.create(tenantA, ownerA, { name: "Iso Supply" });

    const invoice = await invoicesService.create(tenantA, ownerA, {
      direction: "payable",
      counterpartyType: "supplier",
      counterpartyId: supplierA.id,
      projectId: projectA.id,
      issueDate: "2026-02-01",
      lines: [{ costCodeId: costCodeA.id, description: "Cross-tenant probe", amount: "100.00" }],
    });

    await expect(invoicesService.getById(tenantB, invoice.id)).rejects.toThrow(/not found/);
  });
});
