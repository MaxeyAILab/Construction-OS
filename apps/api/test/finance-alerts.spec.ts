import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { financeAlerts } from "../src/infrastructure/db/schema";
import { buildTestAuditServices } from "./setup/audit";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestFinanceAlertsServices } from "./setup/finance-alerts";
import { buildTestProjectServices } from "./setup/projects";

// FR-FIN-6 (ai-spec.md §7.10 Financial AI): rule+AI hybrid margin-erosion
// alerts. The rule (threshold breach) is deterministic and authoritative;
// the AI causal-decomposition explanation is a best-effort enrichment that
// can fail without ever blocking the alert.
describe("Margin Erosion Alerts v1 (FR-FIN-6)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { marginErosionService, financeAlertsWriterService, financeAlertsQueryService, provider } =
    buildTestFinanceAlertsServices(db, projectsService);
  const { auditWriterService } = buildTestAuditServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithBudget(label: string, contractValueAmount: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `margin-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Margin ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount,
    });
    const costCode = await costCodesService.create(signUp.companyId, ownerId, project.id, {
      code: "01-000",
      name: "Labor",
      kind: "labor",
    });
    const budget = await budgetService.create(signUp.companyId, ownerId, project.id, { currency: "USD" });
    return { tenantId: signUp.companyId, ownerId, project, costCode, budget };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function replayLatestOutboxEvent(tenantId: string, eventType: string) {
    const row = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findFirst({ where: (o, { and, eq }) => and(eq(o.tenantId, tenantId), eq(o.eventType, eventType)) }),
    );
    if (!row) throw new Error(`no ${eventType} outbox row found for tenant ${tenantId}`);
    return {
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType,
      payload: row.payload,
      dedupeKey: row.dedupeKey,
      occurredAt: row.occurredAt.toISOString(),
      actorId: row.actorId,
      actorType: row.actorType as "user" | "system" | "ai" | "integration",
    };
  }

  it("fires a warning alert with an AI causal explanation when margin crosses the default warning threshold", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithBudget("warning", "100000.00");
    const budgetRow = await budgetService.getByProject(tenantId, project.id);
    const line = await budgetService.addLine(tenantId, ownerId, budgetRow.id, { costCodeId: costCode.id, originalAmount: "70000.00" });

    provider.setResponse({ content: "Labor costs are the primary driver of the margin pressure.", inputTokens: 80, outputTokens: 30 });

    // 70000 -> 90000: margin drops from 30% to 10% (< 15% default warning, not < 5% critical).
    await budgetService.updateLineOriginalAmount(tenantId, ownerId, line.budgetId, line.id, { originalAmount: "90000.00" });
    await financeAlertsWriterService.handleEnvelope(await replayLatestOutboxEvent(tenantId, "budget_line.updated.v1"));

    const alert = await withTenant(db, tenantId, (tx) => tx.query.financeAlerts.findFirst({ where: eq(financeAlerts.tenantId, tenantId) }));
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("warning");
    expect(alert!.marginPct).toBe("10.00");
    expect(alert!.explanation).toContain("Labor");
    expect(alert!.aiRunId).not.toBeNull();
  });

  it("does not alert while margin stays healthy", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithBudget("healthy", "100000.00");
    const budgetRow = await budgetService.getByProject(tenantId, project.id);
    await budgetService.addLine(tenantId, ownerId, budgetRow.id, { costCodeId: costCode.id, originalAmount: "50000.00" });

    await marginErosionService.checkProject(tenantId, project.id);

    const alerts = await withTenant(db, tenantId, (tx) => tx.query.financeAlerts.findMany({ where: eq(financeAlerts.tenantId, tenantId) }));
    expect(alerts).toHaveLength(0);
  });

  it("escalates to critical and dedups repeated checks at the same severity", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithBudget("escalate", "100000.00");
    const budgetRow = await budgetService.getByProject(tenantId, project.id);
    const line = await budgetService.addLine(tenantId, ownerId, budgetRow.id, { costCodeId: costCode.id, originalAmount: "90000.00" });

    provider.setResponse({ content: "Warning-level explanation.", inputTokens: 50, outputTokens: 20 });
    await marginErosionService.checkProject(tenantId, project.id); // margin 10% -> warning
    await marginErosionService.checkProject(tenantId, project.id); // same severity -> no new row

    let alerts = await withTenant(db, tenantId, (tx) => tx.query.financeAlerts.findMany({ where: eq(financeAlerts.tenantId, tenantId) }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("warning");

    provider.setResponse({ content: "Critical-level explanation.", inputTokens: 50, outputTokens: 20 });
    await budgetService.updateLineOriginalAmount(tenantId, ownerId, line.budgetId, line.id, { originalAmount: "97000.00" });
    await marginErosionService.checkProject(tenantId, project.id); // margin 3% -> critical

    alerts = await withTenant(db, tenantId, (tx) =>
      tx.query.financeAlerts.findMany({ where: eq(financeAlerts.tenantId, tenantId), orderBy: (a, { asc }) => [asc(a.createdAt)] }),
    );
    expect(alerts).toHaveLength(2);
    expect(alerts[1]!.severity).toBe("critical");
  });

  it("still fires the alert when the AI causal explanation fails (rule is authoritative, AI is best-effort)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithBudget("ai-fails", "100000.00");
    const budgetRow = await budgetService.getByProject(tenantId, project.id);
    await budgetService.addLine(tenantId, ownerId, budgetRow.id, { costCodeId: costCode.id, originalAmount: "97000.00" });

    provider.setShouldThrow(true);
    await marginErosionService.checkProject(tenantId, project.id);
    provider.setShouldThrow(false);

    const alert = await withTenant(db, tenantId, (tx) => tx.query.financeAlerts.findFirst({ where: eq(financeAlerts.tenantId, tenantId) }));
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("critical");
    expect(alert!.explanation).toBeNull();
    expect(alert!.aiRunId).toBeNull();
  });

  it("respects configurable thresholds from projects.settings.marginAlerts", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithBudget("configurable", "100000.00");
    const budgetRow = await budgetService.getByProject(tenantId, project.id);
    // margin 40% -> healthy under the default 15%/5% thresholds.
    await budgetService.addLine(tenantId, ownerId, budgetRow.id, { costCodeId: costCode.id, originalAmount: "60000.00" });

    await marginErosionService.checkProject(tenantId, project.id);
    let alerts = await withTenant(db, tenantId, (tx) => tx.query.financeAlerts.findMany({ where: eq(financeAlerts.tenantId, tenantId) }));
    expect(alerts).toHaveLength(0);

    await projectsService.update(tenantId, ownerId, project.id, { settings: { marginAlerts: { warningThresholdPct: 50 } } });
    provider.setResponse({ content: "Configured-threshold explanation.", inputTokens: 40, outputTokens: 15 });
    await marginErosionService.checkProject(tenantId, project.id); // 40% now crosses the configured 50% warning threshold

    alerts = await withTenant(db, tenantId, (tx) => tx.query.financeAlerts.findMany({ where: eq(financeAlerts.tenantId, tenantId) }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.thresholdPct).toBe("50.00");
  });

  it("finance_alert.created.v1 produces an audit_log row carrying the ai_run_id", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithBudget("audit", "100000.00");
    const budgetRow = await budgetService.getByProject(tenantId, project.id);
    await budgetService.addLine(tenantId, ownerId, budgetRow.id, { costCodeId: costCode.id, originalAmount: "97000.00" });

    provider.setResponse({ content: "Audit test explanation.", inputTokens: 40, outputTokens: 15 });
    await marginErosionService.checkProject(tenantId, project.id);

    const envelope = await replayLatestOutboxEvent(tenantId, "finance_alert.created.v1");
    await auditWriterService.handleEnvelope(envelope);

    const auditRow = await withTenant(db, tenantId, (tx) =>
      tx.query.auditLog.findFirst({ where: (a, { and, eq }) => and(eq(a.tenantId, tenantId), eq(a.action, "finance.alert.create")) }),
    );
    expect(auditRow).toBeDefined();
    expect(auditRow!.aiRunId).not.toBeNull();
  });

  it("GET /finance/alerts feed lists alerts across a tenant's projects, filterable by project", async () => {
    const a = await signUpCompanyWithBudget("feed-a", "100000.00");
    const budgetA = await budgetService.getByProject(a.tenantId, a.project.id);
    await budgetService.addLine(a.tenantId, a.ownerId, budgetA.id, { costCodeId: a.costCode.id, originalAmount: "97000.00" });
    await marginErosionService.checkProject(a.tenantId, a.project.id);

    const { data } = await financeAlertsQueryService.list(a.tenantId, { limit: 20 });
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => row.projectId === a.project.id)).toBe(true);

    const filtered = await financeAlertsQueryService.list(a.tenantId, { projectId: a.project.id, limit: 20 });
    expect(filtered.data.length).toBe(data.length);
  });

  it("is immutable: UPDATE and DELETE are rejected even for the table-owning app role", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithBudget("immutable", "100000.00");
    const budgetRow = await budgetService.getByProject(tenantId, project.id);
    await budgetService.addLine(tenantId, ownerId, budgetRow.id, { costCodeId: costCode.id, originalAmount: "97000.00" });
    await marginErosionService.checkProject(tenantId, project.id);

    const alert = await withTenant(db, tenantId, (tx) => tx.query.financeAlerts.findFirst({ where: eq(financeAlerts.tenantId, tenantId) }));
    expect(alert).toBeDefined();

    await expect(
      withTenant(db, tenantId, (tx) => tx.update(financeAlerts).set({ severity: "warning" }).where(eq(financeAlerts.id, alert!.id))),
    ).rejects.toThrow(/append-only/);

    await expect(
      withTenant(db, tenantId, (tx) => tx.delete(financeAlerts).where(eq(financeAlerts.id, alert!.id))),
    ).rejects.toThrow(/append-only/);
  });

  it("RLS: a tenant only sees its own finance_alerts", async () => {
    const a = await signUpCompanyWithBudget("rls-a", "100000.00");
    const b = await signUpCompanyWithBudget("rls-b", "100000.00");
    const budgetA = await budgetService.getByProject(a.tenantId, a.project.id);
    await budgetService.addLine(a.tenantId, a.ownerId, budgetA.id, { costCodeId: a.costCode.id, originalAmount: "97000.00" });
    await marginErosionService.checkProject(a.tenantId, a.project.id);

    const bAlerts = await withTenant(db, b.tenantId, (tx) => tx.query.financeAlerts.findMany({ where: eq(financeAlerts.tenantId, b.tenantId) }));
    expect(bAlerts).toHaveLength(0);
  });
});
