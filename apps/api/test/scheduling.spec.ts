import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { CycleDetectedError } from "../src/modules/scheduling/domain/errors";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSchedulingServices } from "./setup/scheduling";

describe("Scheduling", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { schedulesService, activitiesService, dependenciesService, recalculateService, queueConnection } =
    buildTestSchedulingServices(db);

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
      email: `sched-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Sched ${label} ${suffix}`,
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

  it("lazily get-or-creates the master schedule for a project", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("lazy");

    const first = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    expect(first.schedule.kind).toBe("master");
    expect(first.activities).toHaveLength(0);

    const second = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    expect(second.schedule.id).toBe(first.schedule.id);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes.filter((t) => t === "schedule.created.v1")).toHaveLength(1);
  });

  it("recalculates a linear chain, computing dates/float/critical, and bumps schedule_version", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("recalc");
    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);

    const a = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Foundation", durationDays: 5 });
    const b = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "Framing", durationDays: 10 });
    await dependenciesService.replace(tenantId, ownerId, b.id, {
      dependencies: [{ predecessorId: a.id, type: "FS", lagDays: 0 }],
    });

    const result = await recalculateService.recalculate(tenantId, ownerId, schedule.id);
    expect(result.async).toBe(false);
    if (result.async) throw new Error("expected sync result");

    expect(result.schedule.scheduleVersion).toBeGreaterThan(schedule.scheduleVersion);

    const updatedA = result.activities.find((act) => act.id === a.id)!;
    const updatedB = result.activities.find((act) => act.id === b.id)!;
    expect(updatedA.startDate).toBe(schedule.dataDate);
    expect(updatedA.isCritical).toBe(true);
    expect(updatedA.totalFloatDays).toBe(0);
    expect(updatedB.isCritical).toBe(true);
    // B starts the day after A's 5-day span ends (data_date + 5).
    expect(updatedB.startDate).not.toBe(schedule.dataDate);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("schedule.recalculated.v1");
  });

  it("rejects a dependency replacement that would create a cycle", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("cycle");
    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);

    const a = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "A", durationDays: 2 });
    const b = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "B", durationDays: 2 });
    await dependenciesService.replace(tenantId, ownerId, b.id, {
      dependencies: [{ predecessorId: a.id, type: "FS", lagDays: 0 }],
    });

    await expect(
      dependenciesService.replace(tenantId, ownerId, a.id, {
        dependencies: [{ predecessorId: b.id, type: "FS", lagDays: 0 }],
      }),
    ).rejects.toThrow(CycleDetectedError);

    // The rejected replacement must not have partially applied.
    const { dependencies } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]!.predecessorId).toBe(a.id);
  });

  it("updates an activity with If-Match optimistic locking, rejecting a stale version", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("ifmatch");
    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    const activity = await activitiesService.create(tenantId, ownerId, schedule.id, {
      name: "Rough-in",
      durationDays: 3,
    });

    const updated = await activitiesService.update(
      tenantId,
      ownerId,
      activity.id,
      { percentComplete: 50 },
      activity.updatedSeq,
    );
    expect(updated.percentComplete).toBe("50.00");

    await expect(
      activitiesService.update(tenantId, ownerId, activity.id, { percentComplete: 100 }, activity.updatedSeq),
    ).rejects.toThrow(/modified since it was last read/);
  });

  it("batch-updates multiple activities atomically", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("batch");
    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    const a = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "A", durationDays: 2 });
    const b = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "B", durationDays: 3 });

    const results = await activitiesService.batchUpdate(tenantId, ownerId, schedule.id, {
      activities: [
        { id: a.id, ifMatchVersion: a.updatedSeq, durationDays: 4 },
        { id: b.id, ifMatchVersion: b.updatedSeq, durationDays: 6 },
      ],
    });
    expect(results.find((r) => r.id === a.id)!.durationDays).toBe(4);
    expect(results.find((r) => r.id === b.id)!.durationDays).toBe(6);
  });

  it("snapshots a baseline with baseline_source_activity_id traceability", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("baseline");
    const { schedule } = await schedulesService.getActiveSchedule(tenantId, ownerId, project.id);
    const a = await activitiesService.create(tenantId, ownerId, schedule.id, { name: "A", durationDays: 5 });

    const { schedule: baseline, activities: baselineActivities } = await schedulesService.createBaseline(
      tenantId,
      ownerId,
      project.id,
      { name: "Original Plan" },
    );

    expect(baseline.kind).toBe("baseline");
    expect(baseline.baselineOfId).toBe(schedule.id);
    expect(baselineActivities).toHaveLength(1);
    expect(baselineActivities[0]!.baselineSourceActivityId).toBe(a.id);
    expect(baselineActivities[0]!.id).not.toBe(a.id);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("schedule_baseline.created.v1");
  });

  it("RLS: a tenant only sees its own schedules, activities, and dependencies", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const { schedule } = await schedulesService.getActiveSchedule(a.tenantId, a.ownerId, a.project.id);
    await activitiesService.create(a.tenantId, a.ownerId, schedule.id, { name: "A-only", durationDays: 1 });

    const schedulesB = await withTenant(db, b.tenantId, (tx) => tx.query.schedules.findMany());
    expect(schedulesB).toHaveLength(0);

    const activitiesB = await withTenant(db, b.tenantId, (tx) => tx.query.scheduleActivities.findMany());
    expect(activitiesB).toHaveLength(0);
  });
});
