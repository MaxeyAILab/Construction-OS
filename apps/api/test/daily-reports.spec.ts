import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { companyUsers, costTransactions } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSyncServices } from "./setup/sync";

// roadmap.md Phase 1C "Daily reports + time + weather (offline)"
// (FR-FIELD-1/2, database.md §15).
describe("Daily Reports & Time Entries (M8 Field Operations)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { dailyReportsService, timeEntriesService, cacheRedis } = buildTestSyncServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await cacheRedis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `field-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Field ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    const costCode = await costCodesService.create(signUp.companyId, ownerId, project.id, {
      code: "01-000",
      name: "General",
      kind: "labor",
    });
    return { tenantId: signUp.companyId, ownerId, project, costCode };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  it("creates a daily report as a draft, and lists it back", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("create");
    const report = await dailyReportsService.create(tenantId, ownerId, {
      projectId: project.id,
      reportDate: "2026-07-20",
      narrative: "Poured footings on grid A-D.",
      weather: { conditions: "clear", tempHighF: 82 },
    });
    expect(report.status).toBe("draft");
    expect(report.submittedAt).toBeNull();

    const { data } = await dailyReportsService.list(tenantId, { projectId: project.id, limit: 20 });
    expect(data.map((r) => r.id)).toContain(report.id);
  });

  it("edits a draft, then submits it — narrative/weather edits after submit are rejected", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("submit");
    const report = await dailyReportsService.create(tenantId, ownerId, {
      projectId: project.id,
      reportDate: "2026-07-21",
    });

    const edited = await dailyReportsService.update(tenantId, ownerId, report.id, { narrative: "Updated narrative" });
    expect(edited.narrative).toBe("Updated narrative");
    expect(edited.status).toBe("draft");

    const submitted = await dailyReportsService.update(tenantId, ownerId, report.id, { status: "submitted" });
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedAt).not.toBeNull();

    await expect(
      dailyReportsService.update(tenantId, ownerId, report.id, { narrative: "Too late" }),
    ).rejects.toThrow(/already been submitted/);
  });

  it("enforces one report per project/date/author (offline-first uniqueness)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("unique");
    await dailyReportsService.create(tenantId, ownerId, { projectId: project.id, reportDate: "2026-07-22" });
    await expect(
      dailyReportsService.create(tenantId, ownerId, { projectId: project.id, reportDate: "2026-07-22" }),
    ).rejects.toThrow();
  });

  it("creates a time entry for a named worker", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("time-create");
    const entry = await timeEntriesService.create(tenantId, ownerId, {
      projectId: project.id,
      userId: ownerId,
      costCodeId: costCode.id,
      hours: 8,
      workDate: "2026-07-20",
      kind: "regular",
    });
    expect(entry.hours).toBe("8.00");
    expect(entry.approvedAt).toBeNull();
  });

  it("creates a time entry for a crew label (no named worker)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("time-crew");
    const entry = await timeEntriesService.create(tenantId, ownerId, {
      projectId: project.id,
      crewLabel: "Framing Crew B",
      costCodeId: costCode.id,
      hours: 24,
      workDate: "2026-07-20",
      kind: "regular",
    });
    expect(entry.crewLabel).toBe("Framing Crew B");
    expect(entry.userId).toBeNull();
  });

  it("approves a time entry with no configured hourly rate — succeeds without posting a cost transaction (documented gap)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("approve-norate");
    const entry = await timeEntriesService.create(tenantId, ownerId, {
      projectId: project.id,
      userId: ownerId,
      costCodeId: costCode.id,
      hours: 8,
      workDate: "2026-07-20",
      kind: "regular",
    });

    const approved = await timeEntriesService.approve(tenantId, ownerId, entry.id);
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.costTransactionId).toBeNull();
  });

  it("approves a time entry with a configured hourly rate — posts a cost transaction and updates the budget line actuals (FR-FIELD-2)", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("approve-rate");

    await withTenant(db, tenantId, (tx) =>
      tx.update(companyUsers).set({ hourlyRateAmount: "50.00" }).where(eq(companyUsers.userId, ownerId)),
    );
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "10000.00" });

    const entry = await timeEntriesService.create(tenantId, ownerId, {
      projectId: project.id,
      userId: ownerId,
      costCodeId: costCode.id,
      hours: 8,
      workDate: "2026-07-20",
      kind: "regular",
    });

    const approved = await timeEntriesService.approve(tenantId, ownerId, entry.id);
    expect(approved.costTransactionId).not.toBeNull();

    const txn = await withTenant(db, tenantId, (tx) =>
      tx.query.costTransactions.findFirst({ where: eq(costTransactions.id, approved.costTransactionId!) }),
    );
    expect(txn?.source).toBe("time_entry");
    expect(txn?.amount).toBe("400.00"); // 8 hrs * $50/hr

    const updatedBudget = await budgetService.getByProject(tenantId, project.id);
    expect(updatedBudget.lines[0]!.actualAmount).toBe("400.00");
  });

  it("rejects approving an already-approved time entry", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("approve-twice");
    const entry = await timeEntriesService.create(tenantId, ownerId, {
      projectId: project.id,
      userId: ownerId,
      costCodeId: costCode.id,
      hours: 4,
      workDate: "2026-07-20",
      kind: "regular",
    });
    await timeEntriesService.approve(tenantId, ownerId, entry.id);
    await expect(timeEntriesService.approve(tenantId, ownerId, entry.id)).rejects.toThrow(/already been approved/);
  });

  it("RLS: a tenant only sees its own daily reports and time entries", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await dailyReportsService.create(a.tenantId, a.ownerId, { projectId: a.project.id, reportDate: "2026-07-20" });
    await timeEntriesService.create(a.tenantId, a.ownerId, {
      projectId: a.project.id,
      userId: a.ownerId,
      costCodeId: a.costCode.id,
      hours: 8,
      workDate: "2026-07-20",
      kind: "regular",
    });

    const bReports = await dailyReportsService.list(b.tenantId, { limit: 20 });
    expect(bReports.data).toHaveLength(0);

    const bEntries = await timeEntriesService.list(b.tenantId, { limit: 20 });
    expect(bEntries.data).toHaveLength(0);
  });
});
