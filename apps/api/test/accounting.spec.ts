import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestAccountingServices } from "./setup/accounting";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";

// FR-PLAT-8 (api.md §10, M18 Platform/Admin): "GET/POST
// /integrations/accounting/… | admin.integration.manage | Connect, mapping,
// sync runs, conflict queue." v1 scope: OAuth connect, chart-of-accounts
// mapping, push of unsynced cost_transactions, and a pull/verify pass that
// surfaces QuickBooks-side edits to already-pushed transactions as
// conflicts. AP/AR (invoices/bills) two-way sync is out of scope (no
// customer/vendor identity-mapping subsystem exists).
describe("Accounting (QuickBooks integration)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { costTransactionsService } = buildTestBudgetServices(db);
  const { connectionsService, syncService, syncRunnerService, providers, queueConnection } = buildTestAccountingServices(
    db,
    costTransactionsService,
  );

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await queueConnection.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `acct-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Acct ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    const costCode = await costCodesService.create(signUp.companyId, ownerId, project.id, {
      code: "01",
      name: "General Conditions",
      kind: "other",
    });
    return { tenantId: signUp.companyId, ownerId, project, costCode };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function connectAndMap(tenantId: string, ownerId: string, costCodeId: string) {
    const { authorizationUrl } = await connectionsService.connect(tenantId, ownerId, { provider: "quickbooks" });
    expect(authorizationUrl).toContain("state=");
    const state = new URL(authorizationUrl).searchParams.get("state")!;

    await connectionsService.handleCallback({
      code: "fake-code",
      state,
      realmId: "fake-realm-1",
      redirectUri: "https://api.test/v1/integrations/accounting/callback",
    });

    await connectionsService.updateMapping(tenantId, ownerId, "quickbooks", {
      costCodeMappings: [{ costCodeId, externalAccountId: "acct-1", externalAccountName: "Materials Expense" }],
    });
  }

  it("connects via OAuth, stores no raw tokens in the status response, and supports disconnect", async () => {
    const { tenantId, ownerId, costCode } = await signUpCompanyWithProject("connect");
    await connectAndMap(tenantId, ownerId, costCode.id);

    const status = await connectionsService.getStatus(tenantId, "quickbooks");
    expect(status.status).toBe("connected");
    expect(status.realmId).toBe("fake-realm-1");
    expect(status).not.toHaveProperty("accessTokenEnc");
    expect(status).not.toHaveProperty("refreshTokenEnc");

    const disconnected = await connectionsService.disconnect(tenantId, ownerId, "quickbooks");
    expect(disconnected.status).toBe("disconnected");

    await expect(connectionsService.getValidAccessToken(tenantId, disconnected)).rejects.toMatchObject({
      code: "not_connected",
      status: 409,
    });
  });

  it("rejects triggering a sync run before a connection exists", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("no-conn");
    await expect(syncService.requestRun(tenantId, ownerId, "quickbooks")).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("pushes unsynced cost transactions to QuickBooks and records idempotent links (FR-PLAT-8)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("push");
    await connectAndMap(tenantId, ownerId, costCode.id);

    await costTransactionsService.postManual(tenantId, ownerId, project.id, {
      costCodeId: costCode.id,
      txnDate: "2026-01-15",
      amount: "1500.00",
      memo: "Rebar delivery",
    });

    const run = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    const connection = await connectionsService.getStatus(tenantId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run.id });

    const completed = await syncService.getRun(tenantId, run.id);
    expect(completed.status).toBe("completed");
    expect(completed.pushedCount).toBe(1);
    expect(completed.skippedCount).toBe(0);

    // Idempotent: a second run pushes nothing new.
    const run2 = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run2.id });
    const completed2 = await syncService.getRun(tenantId, run2.id);
    expect(completed2.pushedCount).toBe(0);
  });

  it("skips (does not push) a cost transaction whose cost code has no mapping entry", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("unmapped");
    // Connect but map nothing.
    const { authorizationUrl } = await connectionsService.connect(tenantId, ownerId, { provider: "quickbooks" });
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    await connectionsService.handleCallback({
      code: "fake-code",
      state,
      realmId: "fake-realm-unmapped",
      redirectUri: "https://api.test/v1/integrations/accounting/callback",
    });

    await costTransactionsService.postManual(tenantId, ownerId, project.id, {
      costCodeId: costCode.id,
      txnDate: "2026-01-15",
      amount: "300.00",
    });

    const run = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    const connection = await connectionsService.getStatus(tenantId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run.id });

    const completed = await syncService.getRun(tenantId, run.id);
    expect(completed.pushedCount).toBe(0);
    expect(completed.skippedCount).toBe(1);
  });

  it("detects a QuickBooks-side edit to a pushed transaction as a conflict, then resolves keep_remote by posting an adjustment", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("conflict-remote");
    await connectAndMap(tenantId, ownerId, costCode.id);

    await costTransactionsService.postManual(tenantId, ownerId, project.id, {
      costCodeId: costCode.id,
      txnDate: "2026-01-15",
      amount: "1000.00",
    });

    const connection = await connectionsService.getStatus(tenantId, "quickbooks");
    const run1 = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run1.id });

    // Simulate someone editing the pushed Purchase inside QuickBooks itself.
    // providers.quickbooks.remoteAmounts is shared across every test in this file, so
    // find *this* test's external id by the amount it pushed, not by
    // insertion order.
    const [externalId] = [...providers.quickbooks.remoteAmounts.entries()].find(([, amount]) => amount === "1000.00")!;
    providers.quickbooks.remoteAmounts.set(externalId, "1200.00");

    const run2 = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run2.id });
    const completed2 = await syncService.getRun(tenantId, run2.id);
    expect(completed2.conflictCount).toBe(1);

    const conflicts = await syncService.listConflicts(tenantId, { limit: 20, status: "open" });
    expect(conflicts.data).toHaveLength(1);
    const conflict = conflicts.data.find((c) => c.externalId === externalId)!;
    expect(conflict.localValue).toEqual({ amount: "1000.00" });
    expect(conflict.remoteValue).toEqual({ amount: "1200.00" });

    const resolved = await syncService.resolveConflict(tenantId, ownerId, conflict.id, { resolution: "keep_remote" });
    expect(resolved.status).toBe("resolved_remote");

    // Adjustment ledger entry posted for the $200 delta.
    const txns = await costTransactionsService.list(tenantId, project.id);
    const adjustment = txns.find((t) => t.source === "accounting_sync");
    expect(adjustment?.amount).toBe("200.00");
    expect(adjustment?.externalRef).toBe(externalId);
  });

  it("resolves keep_local by re-asserting our value back onto QuickBooks", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("conflict-local");
    await connectAndMap(tenantId, ownerId, costCode.id);

    await costTransactionsService.postManual(tenantId, ownerId, project.id, {
      costCodeId: costCode.id,
      txnDate: "2026-01-15",
      amount: "500.00",
    });

    const connection = await connectionsService.getStatus(tenantId, "quickbooks");
    const run1 = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run1.id });

    const [externalId] = [...providers.quickbooks.remoteAmounts.keys()].filter((id) => providers.quickbooks.remoteAmounts.get(id) === "500.00");
    providers.quickbooks.remoteAmounts.set(externalId!, "999.00");

    const run2 = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run2.id });

    const conflicts = await syncService.listConflicts(tenantId, { limit: 20, status: "open" });
    const conflict = conflicts.data.find((c) => c.externalId === externalId)!;

    const resolved = await syncService.resolveConflict(tenantId, ownerId, conflict.id, { resolution: "keep_local" });
    expect(resolved.status).toBe("resolved_local");
    expect(providers.quickbooks.remoteAmounts.get(externalId!)).toBe("500.00");
  });

  it("rejects resolving an already-resolved conflict", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("double-resolve");
    await connectAndMap(tenantId, ownerId, costCode.id);
    await costTransactionsService.postManual(tenantId, ownerId, project.id, {
      costCodeId: costCode.id,
      txnDate: "2026-01-15",
      amount: "100.00",
    });
    const connection = await connectionsService.getStatus(tenantId, "quickbooks");
    const run1 = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run1.id });
    const [externalId] = [...providers.quickbooks.remoteAmounts.entries()].find(([, amount]) => amount === "100.00")!;
    providers.quickbooks.remoteAmounts.set(externalId, "150.00");
    const run2 = await syncService.requestRun(tenantId, ownerId, "quickbooks");
    await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run2.id });

    const conflicts = await syncService.listConflicts(tenantId, { limit: 20, status: "open" });
    const conflict = conflicts.data.find((c) => c.externalId === externalId)!;
    await syncService.resolveConflict(tenantId, ownerId, conflict.id, { resolution: "keep_remote" });

    await expect(syncService.resolveConflict(tenantId, ownerId, conflict.id, { resolution: "keep_remote" })).rejects.toMatchObject({
      code: "already_resolved",
      status: 409,
    });
  });

  it("isolates accounting connections and sync runs per tenant (RLS)", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await connectAndMap(a.tenantId, a.ownerId, a.costCode.id);
    await connectAndMap(b.tenantId, b.ownerId, b.costCode.id);

    const runA = await syncService.requestRun(a.tenantId, a.ownerId, "quickbooks");

    await expect(syncService.getRun(a.tenantId, runA.id)).resolves.toMatchObject({ id: runA.id });
    await expect(syncService.getRun(b.tenantId, runA.id)).rejects.toMatchObject({ code: "not_found", status: 404 });

    const runsA = await syncService.listRuns(a.tenantId, { limit: 50 });
    for (const run of runsA.data) {
      expect(run.tenantId).toBe(a.tenantId);
    }
  });

  // roadmap.md "Sage & Xero connectors": success metric is "connector
  // parity checklist" — the same connect/mapping/push/pull/conflict
  // capabilities QuickBooks has, routed through AccountingProviderRegistry
  // by the connection's `provider` column. Xero/Sage additionally require
  // a defaultClearingAccountId (double-entry journal posting) and resolve
  // their realm id via a follow-up call rather than a callback query param.
  describe("Sage & Xero parity", () => {
    it.each(["sage", "xero"] as const)("connects to %s, resolving its realm id without a callback query param", async (providerName) => {
      const { tenantId, ownerId } = await signUpCompanyWithProject(`${providerName}-connect`);
      const { authorizationUrl } = await connectionsService.connect(tenantId, ownerId, { provider: providerName });
      expect(authorizationUrl).toContain(`fake-${providerName}.test`);
      const state = new URL(authorizationUrl).searchParams.get("state")!;

      const result = await connectionsService.handleCallback({
        code: "fake-code",
        state,
        redirectUri: "https://api.test/v1/integrations/accounting/callback",
      });
      expect(result.status).toBe("connected");

      const status = await connectionsService.getStatus(tenantId, providerName);
      expect(status.realmId).toBe(`fake-${providerName}-realm-1`);
    });

    it.each(["sage", "xero"] as const)(
      "pushes a %s cost transaction as a balanced journal via the configured clearing account",
      async (providerName) => {
        const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject(`${providerName}-push`);
        const { authorizationUrl } = await connectionsService.connect(tenantId, ownerId, { provider: providerName });
        const state = new URL(authorizationUrl).searchParams.get("state")!;
        await connectionsService.handleCallback({
          code: "fake-code",
          state,
          redirectUri: "https://api.test/v1/integrations/accounting/callback",
        });
        await connectionsService.updateMapping(tenantId, ownerId, providerName, {
          costCodeMappings: [{ costCodeId: costCode.id, externalAccountId: "acct-1" }],
          defaultClearingAccountId: "acct-clearing",
        });

        await costTransactionsService.postManual(tenantId, ownerId, project.id, {
          costCodeId: costCode.id,
          txnDate: "2026-01-15",
          amount: "750.00",
        });

        const connection = await connectionsService.getStatus(tenantId, providerName);
        const run = await syncService.requestRun(tenantId, ownerId, providerName);
        await syncRunnerService.run({ tenantId, actorId: ownerId, connectionId: connection.id, syncRunId: run.id });

        const completed = await syncService.getRun(tenantId, run.id);
        expect(completed.pushedCount).toBe(1);
        expect(providers[providerName].lastClearingAccountId).toBe("acct-clearing");
      },
    );

    it("keeps QuickBooks and Xero connections for the same tenant independent", async () => {
      const { tenantId, ownerId, costCode } = await signUpCompanyWithProject("multi-provider");
      await connectAndMap(tenantId, ownerId, costCode.id);

      const { authorizationUrl } = await connectionsService.connect(tenantId, ownerId, { provider: "xero" });
      const state = new URL(authorizationUrl).searchParams.get("state")!;
      await connectionsService.handleCallback({ code: "fake-code", state, redirectUri: "https://api.test/v1/integrations/accounting/callback" });

      const qbStatus = await connectionsService.getStatus(tenantId, "quickbooks");
      const xeroStatus = await connectionsService.getStatus(tenantId, "xero");
      expect(qbStatus.status).toBe("connected");
      expect(xeroStatus.status).toBe("connected");
      expect(qbStatus.realmId).not.toBe(xeroStatus.realmId);
    });
  });
});
