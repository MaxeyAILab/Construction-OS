import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { dailyReports } from "../src/infrastructure/db/schema";
import { buildTestAuditServices } from "./setup/audit";
import { buildTestAuthService } from "./setup/auth";
import { buildTestDailyReportAiServices } from "./setup/daily-report-ai";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSyncServices } from "./setup/sync";

// api.md §9: `GET /daily-reports/{id}/ai-summary` (FR-FIELD-6). Draft-only:
// generates a narrative and persists it to daily_reports.ai_summary — a
// column that's existed since the Daily Reports row (0052) with nothing
// populating it — but never touches daily_reports.narrative, the field the
// crew lead actually submits.
describe("Daily-report AI summary (FR-FIELD-6)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { dailyReportsService, timeEntriesService, cacheRedis } = buildTestSyncServices(db);
  const { dailyReportAiService, provider } = buildTestDailyReportAiServices(db, dailyReportsService, timeEntriesService);
  const { auditWriterService } = buildTestAuditServices(db);

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
      email: `dr-ai-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Daily Report AI ${label} ${suffix}`,
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

  it("generates a narrative grounded in weather/notes/labor, persists it, and emits the event", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProject("grounded");
    const report = await dailyReportsService.create(tenantId, ownerId, {
      projectId: project.id,
      reportDate: "2026-07-20",
      narrative: "Poured footings on grid A-D.",
      weather: { conditions: "clear", tempHighF: 82 },
    });
    await timeEntriesService.create(tenantId, ownerId, {
      projectId: project.id,
      dailyReportId: report.id,
      crewLabel: "Framing Crew B",
      costCodeId: costCode.id,
      hours: 8,
      workDate: "2026-07-20",
      kind: "regular",
    });

    provider.setResponse({
      content: "Crews poured footings on grid A-D under clear skies; Framing Crew B logged 8 regular hours.",
      inputTokens: 150,
      outputTokens: 40,
    });

    const result = await dailyReportAiService.generateSummary(tenantId, ownerId, report.id);
    expect(result.narrative).toContain("footings");
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.aiRunId).toBeTruthy();

    expect(provider.lastRequest?.userPrompt).toContain("Framing Crew B");
    expect(provider.lastRequest?.userPrompt).toContain("Poured footings");

    const updated = await withTenant(db, tenantId, (tx) => tx.query.dailyReports.findFirst({ where: eq(dailyReports.id, report.id) }));
    expect(updated!.aiSummary).toBe(result.narrative);
    expect(updated!.narrative).toBe("Poured footings on grid A-D."); // never overwritten

    const eventRow = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findFirst({
        where: (o, { and, eq }) => and(eq(o.tenantId, tenantId), eq(o.eventType, "daily_report.ai_summary_generated.v1")),
      }),
    );
    expect(eventRow).toBeDefined();
    expect((eventRow!.payload as { dailyReportId: string }).dailyReportId).toBe(report.id);
    expect((eventRow!.payload as { aiRunId: string }).aiRunId).toBe(result.aiRunId);
  });

  it("returns a low-confidence summary for a report with no logged data yet", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("sparse");
    const report = await dailyReportsService.create(tenantId, ownerId, { projectId: project.id, reportDate: "2026-07-21" });

    provider.setResponse({ content: "Not enough information was logged for this day.", inputTokens: 40, outputTokens: 15 });

    const result = await dailyReportAiService.generateSummary(tenantId, ownerId, report.id);
    expect(result.confidence).toBeLessThan(0.6);
    expect(provider.lastRequest?.userPrompt).toContain("No weather, notes, or labor hours");
  });

  it("regenerates fresh on every call rather than caching (each call re-meters an AI run)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("regenerate");
    const report = await dailyReportsService.create(tenantId, ownerId, {
      projectId: project.id,
      reportDate: "2026-07-22",
      narrative: "Framing continued on level 3.",
    });

    provider.setResponse({ content: "First summary.", inputTokens: 50, outputTokens: 10 });
    const first = await dailyReportAiService.generateSummary(tenantId, ownerId, report.id);

    provider.setResponse({ content: "Second summary, revised.", inputTokens: 55, outputTokens: 12 });
    const second = await dailyReportAiService.generateSummary(tenantId, ownerId, report.id);

    expect(first.aiRunId).not.toBe(second.aiRunId);
    expect(second.narrative).toBe("Second summary, revised.");

    const updated = await withTenant(db, tenantId, (tx) => tx.query.dailyReports.findFirst({ where: eq(dailyReports.id, report.id) }));
    expect(updated!.aiSummary).toBe("Second summary, revised.");
  });

  it("daily_report.ai_summary_generated.v1 produces an audit_log row carrying the ai_run_id", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("audit");
    const report = await dailyReportsService.create(tenantId, ownerId, { projectId: project.id, reportDate: "2026-07-23" });

    provider.setResponse({ content: "Summary for audit test.", inputTokens: 30, outputTokens: 10 });
    await dailyReportAiService.generateSummary(tenantId, ownerId, report.id);

    const envelope = await replayLatestOutboxEvent(tenantId, "daily_report.ai_summary_generated.v1");
    await auditWriterService.handleEnvelope(envelope);

    const auditRow = await withTenant(db, tenantId, (tx) =>
      tx.query.auditLog.findFirst({
        where: (a, { and, eq }) => and(eq(a.tenantId, tenantId), eq(a.action, "field.daily_report.ai_summarize")),
      }),
    );
    expect(auditRow).toBeDefined();
    expect(auditRow!.aiRunId).not.toBeNull();
    expect(auditRow!.entityId).toBe(report.id);
  });

  it("RLS: generating a summary for another tenant's report fails (not found)", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const report = await dailyReportsService.create(a.tenantId, a.ownerId, { projectId: a.project.id, reportDate: "2026-07-24" });

    await expect(dailyReportAiService.generateSummary(b.tenantId, b.ownerId, report.id)).rejects.toThrow();
  });
});
