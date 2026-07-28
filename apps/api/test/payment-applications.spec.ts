import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { buildTestRbacServices } from "./setup/rbac";
import { buildTestSubcontractorServices } from "./setup/subcontractors";

// Payment Applications (AIA-style progress billing, FR-FIN-4, database.md
// §11, api.md §10).
describe("Payment Applications (AIA)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService, costTransactionsService } = buildTestBudgetServices(db);
  const { stockService } = buildTestInventoryServices(db);
  const { suppliersService, purchaseOrdersService, redis: procurementRedis } = buildTestProcurementServices(
    db,
    stockService,
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
  const { paymentApplicationsService, pdfRunnerService, companySettingsService, queueConnection, cacheRedis } =
    buildTestPaymentApplicationServices(db, invoicesService, fileUploadService);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await procurementRedis.quit();
    await cacheRedis.quit();
    await queueConnection.quit();
    await fileQueueConnection.quit();
    await rbacRedis.quit();
  });

  async function signUpCompanyWithProjectAndBudget(label: string, withClient: boolean) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `payapp-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `PayApp ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);

    let clientContactCompanyId: string | undefined;
    if (withClient) {
      const client = await contactCompaniesService.create(signUp.companyId, ownerId, { name: "Acme Developers" });
      clientContactCompanyId = client.id;
    }

    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
      clientContactCompanyId,
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

  it("creates a payment application, auto-numbering periods and computing header totals from lines", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("create", true);

    const app = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-01-31",
      lines: [
        {
          costCodeId: costCode.id,
          scheduledValue: "10000.00",
          thisPeriod: "2000.00",
          materialsStored: "500.00",
          retainagePct: "10.00",
        },
      ],
    });
    expect(app.periodNumber).toBe(1);
    expect(app.status).toBe("draft");
    expect(app.totalScheduledValue).toBe("10000.00");
    expect(app.totalCompletedAndStored).toBe("2500.00");
    expect(app.totalRetainage).toBe("250.00");
    expect(app.currentPaymentDue).toBe("2250.00");

    const second = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-02-28",
      lines: [{ costCodeId: costCode.id, scheduledValue: "10000.00", previousCompleted: "2500.00", thisPeriod: "1000.00" }],
    });
    expect(second.periodNumber).toBe(2);
  });

  it("rejects a line for a cost code that doesn't belong to the project", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProjectAndBudget("badcode", true);

    await expect(
      paymentApplicationsService.create(tenantId, ownerId, project.id, {
        periodEndDate: "2026-01-31",
        lines: [{ costCodeId: "00000000-0000-0000-0000-000000000000", scheduledValue: "1000.00", thisPeriod: "100.00" }],
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("only allows edits (addLine, submit) while draft", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("draftonly", true);

    const app = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-01-31",
      lines: [{ costCodeId: costCode.id, scheduledValue: "10000.00", thisPeriod: "1000.00" }],
    });
    await paymentApplicationsService.submit(tenantId, ownerId, app.id);

    await expect(
      paymentApplicationsService.addLine(tenantId, ownerId, app.id, {
        costCodeId: costCode.id,
        scheduledValue: "500.00",
        thisPeriod: "100.00",
      }),
    ).rejects.toMatchObject({ code: "illegal_transition", status: 422 });

    await expect(paymentApplicationsService.submit(tenantId, ownerId, app.id)).rejects.toMatchObject({
      code: "illegal_transition",
    });
  });

  it("approve() bills the project's client for the net new amount due this period (FR-FIN-4)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("approve", true);

    const app = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-01-31",
      lines: [
        {
          costCodeId: costCode.id,
          scheduledValue: "10000.00",
          thisPeriod: "2000.00",
          materialsStored: "500.00",
          retainagePct: "10.00",
        },
      ],
    });
    await expect(paymentApplicationsService.approve(tenantId, ownerId, app.id)).rejects.toMatchObject({
      code: "illegal_transition",
    });

    await paymentApplicationsService.submit(tenantId, ownerId, app.id);
    const approved = await paymentApplicationsService.approve(tenantId, ownerId, app.id);
    expect(approved.status).toBe("approved");
    expect(approved.invoiceId).toBeTruthy();

    const invoice = await invoicesService.getById(tenantId, approved.invoiceId!);
    expect(invoice.direction).toBe("receivable");
    expect(invoice.counterpartyType).toBe("client");
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]!.amount).toBe("2250.00");
  });

  // spec.md §10.2 (Segregation of duties): "Financial approvals ... support
  // maker/checker workflows for enterprise tenants."
  it("segregation of duties: blocks the creator from approving their own payment application once enabled, but a different approver can", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("maker-checker", true);

    await companySettingsService.update(tenantId, ownerId, { settings: { enforceMakerChecker: true } });

    const app = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-01-31",
      lines: [{ costCodeId: costCode.id, scheduledValue: "10000.00", thisPeriod: "1000.00" }],
    });
    await paymentApplicationsService.submit(tenantId, ownerId, app.id);

    await expect(paymentApplicationsService.approve(tenantId, ownerId, app.id)).rejects.toMatchObject({
      code: "maker_checker_violation",
      status: 409,
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: checkerId } = await rbacService.inviteUser(
      tenantId,
      `checker-${suffix}@example.com`,
      "Checker",
      ownerId,
      "internal",
    );
    const approved = await paymentApplicationsService.approve(tenantId, checkerId, app.id);
    expect(approved.status).toBe("approved");
  });

  it("refuses to approve a payment application for a project with no client set (FR-FIN-4 gap guard)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("noclient", false);

    const app = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-01-31",
      lines: [{ costCodeId: costCode.id, scheduledValue: "10000.00", thisPeriod: "1000.00" }],
    });
    await paymentApplicationsService.submit(tenantId, ownerId, app.id);

    await expect(paymentApplicationsService.approve(tenantId, ownerId, app.id)).rejects.toMatchObject({
      code: "no_client_for_project",
      status: 422,
    });
  });

  it("void() is blocked once a payment application is approved", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("void", true);

    const draft = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-01-31",
      lines: [{ costCodeId: costCode.id, scheduledValue: "1000.00", thisPeriod: "100.00" }],
    });
    const voided = await paymentApplicationsService.void(tenantId, ownerId, draft.id);
    expect(voided.status).toBe("void");

    const app = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-02-28",
      lines: [{ costCodeId: costCode.id, scheduledValue: "1000.00", thisPeriod: "100.00" }],
    });
    await paymentApplicationsService.submit(tenantId, ownerId, app.id);
    await paymentApplicationsService.approve(tenantId, ownerId, app.id);

    await expect(paymentApplicationsService.void(tenantId, ownerId, app.id)).rejects.toMatchObject({
      code: "illegal_transition",
      status: 422,
    });
  });

  it("generate-pdf pipeline: requestPdf marks 'generating', the runner renders a PDF and files it as a document version, and flips to 'ready' (api.md §10)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("pdf", true);

    const app = await paymentApplicationsService.create(tenantId, ownerId, project.id, {
      periodEndDate: "2026-01-31",
      lines: [{ costCodeId: costCode.id, scheduledValue: "10000.00", thisPeriod: "2000.00", retainagePct: "10.00" }],
    });

    const generating = await paymentApplicationsService.requestPdf(tenantId, ownerId, app.id);
    expect(generating.pdfStatus).toBe("generating");

    await pdfRunnerService.run({ tenantId, actorId: ownerId, paymentApplicationId: app.id });

    const ready = await paymentApplicationsService.getById(tenantId, app.id);
    expect(ready.pdfStatus).toBe("ready");
    expect(ready.documentId).toBeTruthy();
    expect(ready.pdfDocumentVersionId).toBeTruthy();

    // A second generation reuses the same document, adding a new version.
    await paymentApplicationsService.requestPdf(tenantId, ownerId, app.id);
    await pdfRunnerService.run({ tenantId, actorId: ownerId, paymentApplicationId: app.id });
    const regenerated = await paymentApplicationsService.getById(tenantId, app.id);
    expect(regenerated.documentId).toBe(ready.documentId);
    expect(regenerated.pdfDocumentVersionId).not.toBe(ready.pdfDocumentVersionId);
  });

  it("enforces tenant isolation for payment applications", async () => {
    const { tenantId: tenantA, ownerId: ownerA, project: projectA, costCode: costCodeA } =
      await signUpCompanyWithProjectAndBudget("iso-a", true);
    const { tenantId: tenantB } = await signUpCompanyWithProjectAndBudget("iso-b", true);

    const app = await paymentApplicationsService.create(tenantA, ownerA, projectA.id, {
      periodEndDate: "2026-01-31",
      lines: [{ costCodeId: costCodeA.id, scheduledValue: "1000.00", thisPeriod: "100.00" }],
    });

    await expect(paymentApplicationsService.getById(tenantB, app.id)).rejects.toThrow(/not found/);
  });
});
