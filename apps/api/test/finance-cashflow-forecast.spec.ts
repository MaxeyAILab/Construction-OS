import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanySettingsService } from "../src/modules/auth/application/company-settings.service";
import { CertificationsService } from "../src/modules/safety";
import { SubcontractorsService } from "../src/modules/subcontractors/application/subcontractors.service";
import { ContactCompaniesService } from "../src/modules/crm/application/contact-companies.service";
import { CostTransactionsService } from "../src/modules/budgets/application/cost-transactions.service";
import { OutboxService } from "../src/modules/events/application/outbox.service";
import { InvoicesService } from "../src/modules/finance/application/invoices.service";
import { PurchaseOrdersService } from "../src/modules/procurement/application/purchase-orders.service";
import { SuppliersService } from "../src/modules/procurement/application/suppliers.service";
import { ExternalSharesService } from "../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../src/modules/rbac/infrastructure/permission-cache.service";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestFinanceAlertsServices } from "./setup/finance-alerts";
import { buildTestProjectServices } from "./setup/projects";

// ai-spec.md §7.10 (Financial AI, M9) / FR-FIN-7. api.md §10:
// "POST /finance/ai/cashflow-forecast". Company-wide (not project-scoped)
// deterministic week-by-week bucketing of open invoices + a best-effort
// AI narrative on top — see CashflowForecastService's doc comment for the
// full scoping rationale.
//
// Invoices are created with no projectId to keep this test's dependency
// graph to exactly what InvoicesService's constructor needs (suppliers +
// contact companies for the two counterparty types this suite exercises)
// without pulling in cost-code/budget/PO plumbing InvoicesService only
// touches when an invoice IS project-linked.
describe("Financial AI: cash-flow forecast (FR-FIN-7)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  // marginErosionService (unused by this suite) needs a ProjectsService to
  // construct — buildTestFinanceAlertsServices' own required collaborator.
  const { cashflowForecastService, cashflowForecastAiProvider } = buildTestFinanceAlertsServices(db, projectsService);

  const outbox = new OutboxService();
  const cache = new PermissionCacheService(redis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);
  const suppliersService = new SuppliersService(db, outbox);
  const purchaseOrdersService = new PurchaseOrdersService(db, outbox, suppliersService, permissions, externalShares);
  const subcontractorsService = new SubcontractorsService(db, outbox, new CertificationsService(db, outbox));
  const contactCompaniesService = new ContactCompaniesService(db, outbox);
  const costTransactionsService = new CostTransactionsService(db, outbox);
  const companySettingsService = new CompanySettingsService(db, outbox);
  const invoicesService = new InvoicesService(
    db,
    outbox,
    purchaseOrdersService,
    suppliersService,
    subcontractorsService,
    contactCompaniesService,
    costTransactionsService,
    companySettingsService,
  );

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `cashflow-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Cashflow ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    return { tenantId: signUp.companyId, ownerId };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  function daysFromNow(days: number): string {
    return isoDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  }

  async function approvedReceivable(tenantId: string, ownerId: string, amount: string, dueDate?: string) {
    const client = await contactCompaniesService.create(tenantId, ownerId, { name: "Acme Client" });
    const invoice = await invoicesService.create(tenantId, ownerId, {
      direction: "receivable",
      counterpartyType: "client",
      counterpartyId: client.id,
      issueDate: daysFromNow(0),
      dueDate,
      lines: [{ description: "Progress billing", amount }],
    });
    return invoicesService.approve(tenantId, ownerId, invoice.id);
  }

  async function approvedPayable(tenantId: string, ownerId: string, amount: string, dueDate?: string) {
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Ridgeline Supply" });
    const invoice = await invoicesService.create(tenantId, ownerId, {
      direction: "payable",
      counterpartyType: "supplier",
      counterpartyId: supplier.id,
      issueDate: daysFromNow(0),
      dueDate,
      lines: [{ description: "Materials", amount }],
    });
    return invoicesService.approve(tenantId, ownerId, invoice.id);
  }

  it("buckets open invoices into weekly inflow/outflow with a running cumulative balance", async () => {
    const { tenantId, ownerId } = await signUpCompany("buckets");

    await approvedReceivable(tenantId, ownerId, "10000.00", daysFromNow(3)); // week 0
    await approvedPayable(tenantId, ownerId, "4000.00", daysFromNow(5)); // week 0
    await approvedReceivable(tenantId, ownerId, "6000.00", daysFromNow(10)); // week 1

    const result = await cashflowForecastService.forecast(tenantId, ownerId, 3);

    expect(result.horizonWeeks).toBe(3);
    expect(result.weeks).toHaveLength(3);
    expect(result.weeks[0]!.projectedInflow).toBe("10000.00");
    expect(result.weeks[0]!.projectedOutflow).toBe("4000.00");
    expect(result.weeks[0]!.netCashFlow).toBe("6000.00");
    expect(result.weeks[0]!.cumulativeCashFlow).toBe("6000.00");
    expect(result.weeks[1]!.projectedInflow).toBe("6000.00");
    expect(result.weeks[1]!.cumulativeCashFlow).toBe("12000.00");
    expect(result.weeks[2]!.projectedInflow).toBe("0.00");
    expect(result.weeks[2]!.cumulativeCashFlow).toBe("12000.00");
  });

  it("confidence narrows (and the band widens) further out in the horizon", async () => {
    const { tenantId, ownerId } = await signUpCompany("confidence");
    await approvedReceivable(tenantId, ownerId, "5000.00", daysFromNow(1));

    const result = await cashflowForecastService.forecast(tenantId, ownerId, 5);

    expect(result.weeks[0]!.confidence).toBeGreaterThan(result.weeks[4]!.confidence);
    const week0BandWidth = Number(result.weeks[0]!.upperBound) - Number(result.weeks[0]!.lowerBound);
    const week4BandWidth = Number(result.weeks[4]!.upperBound) - Number(result.weeks[4]!.lowerBound);
    expect(week4BandWidth).toBeGreaterThanOrEqual(week0BandWidth);
  });

  it("clamps an already-overdue invoice into week 0 rather than dropping it", async () => {
    const { tenantId, ownerId } = await signUpCompany("overdue");
    await approvedPayable(tenantId, ownerId, "2500.00", daysFromNow(-10)); // 10 days overdue

    const result = await cashflowForecastService.forecast(tenantId, ownerId, 2);
    expect(result.weeks[0]!.projectedOutflow).toBe("2500.00");
  });

  it("falls back to a net-30 expected date when an invoice has no explicit dueDate", async () => {
    const { tenantId, ownerId } = await signUpCompany("net30");
    await approvedReceivable(tenantId, ownerId, "8000.00"); // no dueDate -> issueDate + 30 days

    const result = await cashflowForecastService.forecast(tenantId, ownerId, 6);
    // 30 days out lands in week 4 (days 28-34).
    expect(result.weeks[4]!.projectedInflow).toBe("8000.00");
    expect(result.weeks[0]!.projectedInflow).toBe("0.00");
  });

  it("excludes invoices that are fully paid or still draft", async () => {
    const { tenantId, ownerId } = await signUpCompany("excluded");
    const client = await contactCompaniesService.create(tenantId, ownerId, { name: "Draft Client" });
    // Draft — never approved, must not appear in the forecast.
    await invoicesService.create(tenantId, ownerId, {
      direction: "receivable",
      counterpartyType: "client",
      counterpartyId: client.id,
      issueDate: daysFromNow(0),
      dueDate: daysFromNow(2),
      lines: [{ description: "Unapproved billing", amount: "9000.00" }],
    });

    const result = await cashflowForecastService.forecast(tenantId, ownerId, 1);
    expect(result.weeks[0]!.projectedInflow).toBe("0.00");
  });

  it("AI summary is populated on success and degrades gracefully on failure", async () => {
    const { tenantId, ownerId } = await signUpCompany("ai");
    await approvedReceivable(tenantId, ownerId, "3000.00", daysFromNow(2));

    cashflowForecastAiProvider.setResponse({ content: "Inflows dominate this short horizon.", inputTokens: 30, outputTokens: 10 });
    const ok = await cashflowForecastService.forecast(tenantId, ownerId, 2);
    expect(ok.summary).toBe("Inflows dominate this short horizon.");
    expect(ok.aiRunId).not.toBeNull();

    cashflowForecastAiProvider.setShouldThrow(true);
    const failed = await cashflowForecastService.forecast(tenantId, ownerId, 2);
    expect(failed.summary).toBeNull();
    expect(failed.aiRunId).toBeNull();
    expect(failed.weeks).toEqual(ok.weeks);
    cashflowForecastAiProvider.setShouldThrow(false);
  });

  it("RLS: a tenant's forecast never includes another tenant's invoices", async () => {
    const a = await signUpCompany("rls-a");
    const b = await signUpCompany("rls-b");
    await approvedReceivable(a.tenantId, a.ownerId, "15000.00", daysFromNow(1));

    const forecastB = await cashflowForecastService.forecast(b.tenantId, b.ownerId, 1);
    expect(forecastB.weeks[0]!.projectedInflow).toBe("0.00");
  });
});
