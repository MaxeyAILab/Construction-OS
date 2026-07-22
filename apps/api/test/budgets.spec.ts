import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";

describe("Budget & cost ledger", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService, costTransactionsService, financialSummaryService } =
    buildTestBudgetServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `budget-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Budget ${label} ${suffix}`,
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

  it("creates a budget, rejects a second active one, and fetches it with lines", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("crud");

    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    expect(budget.status).toBe("active");
    expect(budget.originalTotalAmount).toBe("0.00");

    await expect(
      budgetService.create(tenantId, ownerId, project.id, { currency: "USD" }),
    ).rejects.toThrow(/already has an active budget/);

    const fetched = await budgetService.getByProject(tenantId, project.id);
    expect(fetched.id).toBe(budget.id);
    expect(fetched.lines).toEqual([]);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("budget.created.v1");
  });

  it("adds a budget line: revised_amount is generated, totals recompute, duplicates and foreign cost codes are rejected", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("lines");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "General Conditions",
      kind: "other",
    });

    const line = await budgetService.addLine(tenantId, ownerId, budget.id, {
      costCodeId: costCode.id,
      originalAmount: "50000.00",
    });
    expect(line.revisedAmount).toBe("50000.00");
    expect(line.forecastAtCompletionAmount).toBe("50000.00");

    const updatedBudget = await budgetService.getByProject(tenantId, project.id);
    expect(updatedBudget.originalTotalAmount).toBe("50000.00");
    expect(updatedBudget.revisedTotalAmount).toBe("50000.00");

    await expect(
      budgetService.addLine(tenantId, ownerId, budget.id, {
        costCodeId: costCode.id,
        originalAmount: "1.00",
      }),
    ).rejects.toThrow(/already has a budget line/);

    const { project: otherProject } = await signUpCompanyWithProject("other");
    await expect(
      budgetService.addLine(tenantId, ownerId, budget.id, {
        costCodeId: otherProject.id, // not even a cost code id, just proves it's rejected
        originalAmount: "1.00",
      }),
    ).rejects.toThrow(/does not belong to this project/);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("budget_line.created.v1");
  });

  it("updates a line's original amount pre-lock and recomputes forecast + budget totals", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("update");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    const line = await budgetService.addLine(tenantId, ownerId, budget.id, {
      costCodeId: costCode.id,
      originalAmount: "10000.00",
    });

    const updated = await budgetService.updateLineOriginalAmount(tenantId, ownerId, budget.id, line.id, {
      originalAmount: "20000.00",
    });
    expect(updated.revisedAmount).toBe("20000.00");
    expect(updated.forecastAtCompletionAmount).toBe("20000.00");

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    expect(budgetAfter.originalTotalAmount).toBe("20000.00");

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("budget_line.updated.v1");
  });

  it("posts a manual cost transaction: actual/forecast update on the matching line, ledger records regardless", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("costtxn");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, {
      costCodeId: costCode.id,
      originalAmount: "10000.00",
    });

    const txn = await costTransactionsService.postManual(tenantId, ownerId, project.id, {
      costCodeId: costCode.id,
      txnDate: "2026-08-15",
      amount: "3000.00",
      memo: "Mobilization invoice",
    });
    expect(txn.source).toBe("manual");

    const afterPost = await budgetService.getByProject(tenantId, project.id);
    const line = afterPost.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.actualAmount).toBe("3000.00");
    expect(line.forecastToCompleteAmount).toBe("7000.00");
    // The naive budget-based forecast always keeps FAC == revised.
    expect(line.forecastAtCompletionAmount).toBe("10000.00");

    const ledger = await costTransactionsService.list(tenantId, project.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount).toBe("3000.00");

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("cost_transaction.posted.v1");
  });

  it("posts a cost transaction for a cost code with no budget line yet, without erroring", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("nolinetxn");
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "02",
      name: "Sitework",
      kind: "subcontract",
    });

    const txn = await costTransactionsService.postManual(tenantId, ownerId, project.id, {
      costCodeId: costCode.id,
      txnDate: "2026-08-01",
      amount: "500.00",
    });
    expect(txn.amount).toBe("500.00");

    const ledger = await costTransactionsService.list(tenantId, project.id);
    expect(ledger).toHaveLength(1);
  });

  it("financial summary: computes live totals and margin against contract value", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("summary");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const gc = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    const sitework = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "02",
      name: "Sitework",
      kind: "subcontract",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, {
      costCodeId: gc.id,
      originalAmount: "100000.00",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, {
      costCodeId: sitework.id,
      originalAmount: "200000.00",
    });
    await costTransactionsService.postManual(tenantId, ownerId, project.id, {
      costCodeId: gc.id,
      txnDate: "2026-08-01",
      amount: "40000.00",
    });

    const summary = await financialSummaryService.get(tenantId, project.id);
    expect(summary.originalTotal).toBe("300000.00");
    expect(summary.revisedTotal).toBe("300000.00");
    expect(summary.actualTotal).toBe("40000.00");
    expect(summary.forecastAtCompletion).toBe("300000.00");
    expect(summary.variance).toBe("0.00");
    // contract value 1,000,000 - FAC 300,000 = 700,000 margin, 70%
    expect(summary.marginAmount).toBe("700000.00");
    expect(summary.marginPct).toBe(70);
  });

  it("financial summary: returns zeroed totals (not an error) when no budget exists yet", async () => {
    const { tenantId, project } = await signUpCompanyWithProject("nobudget");
    const summary = await financialSummaryService.get(tenantId, project.id);
    expect(summary.budgetId).toBeNull();
    expect(summary.originalTotal).toBe("0.00");
    expect(summary.marginAmount).toBe("1000000.00");
  });

  it("RLS: a tenant only sees its own budgets", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await budgetService.create(a.tenantId, a.ownerId, a.project.id, { currency: "USD" });

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.budgets.findMany());
    expect(rowsB).toHaveLength(0);
  });
});
