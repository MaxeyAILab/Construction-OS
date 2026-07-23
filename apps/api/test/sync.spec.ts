import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant } from "../src/infrastructure/db/client";
import { syncMutations } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";
import { buildTestSyncServices } from "./setup/sync";

describe("Mobile Sync v1: mutation log, delta pull, conflict queue (tasks)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const {
    syncMutationsService,
    syncDeltaService,
    syncWorkingSetService,
    syncConflictsService,
    tasksService,
    dailyReportsService,
    cacheRedis,
  } = buildTestSyncServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await rbacRedis.quit();
    await cacheRedis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `sync-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Sync ${label} ${suffix}`,
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

  function capturedNow(): string {
    return new Date().toISOString();
  }

  it("create: applies a mutation with a client-generated id", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("create");
    const taskId = randomUUID();
    const mutationId = randomUUID();

    const [result] = await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId,
        clientId: "device-1",
        entity: "tasks",
        entityId: taskId,
        op: "create",
        changes: { projectId: project.id, title: "Inspect footings" },
        capturedAt: capturedNow(),
      },
    ]);
    expect(result).toEqual({ mutationId, result: "applied" });

    const task = await tasksService.getById(tenantId, taskId);
    expect(task.id).toBe(taskId);
    expect(task.title).toBe("Inspect footings");
  });

  it("is idempotent: replaying the same mutation_id returns the stored result without reprocessing", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("idempotent");
    const taskId = randomUUID();
    const mutationId = randomUUID();
    const mutation = {
      mutationId,
      clientId: "device-1",
      entity: "tasks" as const,
      entityId: taskId,
      op: "create" as const,
      changes: { projectId: project.id, title: "Once only" },
      capturedAt: capturedNow(),
    };

    const [first] = await syncMutationsService.applyBatch(tenantId, ownerId, [mutation]);
    const [second] = await syncMutationsService.applyBatch(tenantId, ownerId, [mutation]);
    expect(first.result).toBe("applied");
    expect(second.result).toBe("applied");

    const rows = await withTenant(db, tenantId, (tx) => tx.query.syncMutations.findMany({ where: eq(syncMutations.entityId, taskId) }));
    expect(rows).toHaveLength(1); // not reprocessed into a second row
  });

  it("update: applies cleanly when base_version matches", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("update-clean");
    const created = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Original" });

    const [result] = await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "tasks",
        entityId: created.id,
        op: "update",
        changes: { title: "Updated title" },
        baseVersion: created.updatedSeq,
        capturedAt: capturedNow(),
      },
    ]);
    expect(result.result).toBe("applied");

    const updated = await tasksService.getById(tenantId, created.id);
    expect(updated.title).toBe("Updated title");
  });

  it("update: merges when the incoming value already matches the server's current value", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("update-merge");
    const created = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Same" });
    // Someone else already set the status to done; base_version is stale
    // but the field the client is changing already matches.
    const alreadyChanged = await tasksService.update(tenantId, ownerId, created.id, { status: "done" }, created.updatedSeq);

    const [result] = await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "tasks",
        entityId: created.id,
        op: "update",
        changes: { status: "done" },
        baseVersion: created.updatedSeq, // stale on purpose
        capturedAt: capturedNow(),
      },
    ]);
    expect(result.result).toBe("merged");
    expect(alreadyChanged.status).toBe("done");
  });

  it("update: flags a genuine conflict (stale base_version, differing values) — never silently dropped", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("update-conflict");
    const created = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Original" });
    await tasksService.update(tenantId, ownerId, created.id, { title: "Changed by someone else" }, created.updatedSeq);

    const [result] = await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "tasks",
        entityId: created.id,
        op: "update",
        changes: { title: "Changed offline" },
        baseVersion: created.updatedSeq, // stale
        capturedAt: capturedNow(),
      },
    ]);
    expect(result.result).toBe("conflict");

    const conflicts = await syncConflictsService.list(tenantId, ownerId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.entityId).toBe(created.id);
  });

  it("resolves a conflict via accept_client: re-applies the offline edit", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("resolve-client");
    const created = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Original" });
    await tasksService.update(tenantId, ownerId, created.id, { title: "Server edit" }, created.updatedSeq);
    const [{ mutationId }] = await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "tasks",
        entityId: created.id,
        op: "update",
        changes: { title: "Client edit" },
        baseVersion: created.updatedSeq,
        capturedAt: capturedNow(),
      },
    ]);
    const [conflict] = await syncConflictsService.list(tenantId, ownerId);
    expect(conflict!.mutationId).toBe(mutationId);

    const resolved = await syncConflictsService.resolve(tenantId, ownerId, conflict!.id, { resolution: "accept_client" });
    expect(resolved.result).toBe("applied");

    const task = await tasksService.getById(tenantId, created.id);
    expect(task.title).toBe("Client edit");
  });

  it("resolves a conflict via accept_server: discards the offline edit", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("resolve-server");
    const created = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Original" });
    await tasksService.update(tenantId, ownerId, created.id, { title: "Server edit" }, created.updatedSeq);
    await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "tasks",
        entityId: created.id,
        op: "update",
        changes: { title: "Client edit" },
        baseVersion: created.updatedSeq,
        capturedAt: capturedNow(),
      },
    ]);
    const [conflict] = await syncConflictsService.list(tenantId, ownerId);

    const resolved = await syncConflictsService.resolve(tenantId, ownerId, conflict!.id, { resolution: "accept_server" });
    expect(resolved.result).toBe("rejected");

    const task = await tasksService.getById(tenantId, created.id);
    expect(task.title).toBe("Server edit");
  });

  it("rejects a mutation from a caller with no tasks.task.create permission", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("no-perm");
    const invited = await rbacService.inviteUser(tenantId, `sync-bystander-${Date.now()}@example.com`, "Bystander", ownerId);

    const [result] = await syncMutationsService.applyBatch(tenantId, invited.userId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "tasks",
        entityId: randomUUID(),
        op: "create",
        changes: { projectId: project.id, title: "Should not be created" },
        capturedAt: capturedNow(),
      },
    ]);
    expect(result.result).toBe("rejected");
  });

  it("delta: pulls created/updated tasks since a cursor, including tombstones for deletions", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("delta");
    const a = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "A" });
    await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "B" });

    const firstPull = await syncDeltaService.getDelta(tenantId, ownerId, 0, ["tasks"]);
    expect(firstPull.tasks).toHaveLength(2);
    expect(firstPull.nextSinceSeq).toBeGreaterThan(0);

    await tasksService.remove(tenantId, ownerId, a.id);
    const secondPull = await syncDeltaService.getDelta(tenantId, ownerId, firstPull.nextSinceSeq, ["tasks"]);
    expect(secondPull.tasks).toHaveLength(1);
    expect(secondPull.tasks[0]!.id).toBe(a.id);
    expect(secondPull.tasks[0]!.deletedAt).not.toBeNull(); // tombstone
  });

  it("delta: an unrequested scope returns nothing", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("delta-scope");
    const result = await syncDeltaService.getDelta(tenantId, ownerId, 0, ["photos"]);
    expect(result).toEqual({ tasks: [], dailyReports: [], timeEntries: [], nextSinceSeq: 0 });
  });

  it("create: applies a daily_reports mutation with a client-generated id", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("dr-create");
    const dailyReportId = randomUUID();

    const [result] = await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "daily_reports",
        entityId: dailyReportId,
        op: "create",
        changes: { projectId: project.id, reportDate: "2026-07-20", narrative: "Offline-filed report" },
        capturedAt: capturedNow(),
      },
    ]);
    expect(result).toEqual({ mutationId: expect.any(String), result: "applied" });

    const report = await dailyReportsService.getById(tenantId, dailyReportId);
    expect(report.narrative).toBe("Offline-filed report");
  });

  it("create: applies a time_entries mutation, but a subsequent update mutation is rejected as unsupported (append-only)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("te-create");
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "01-000",
      name: "General",
      kind: "labor",
    });
    const timeEntryId = randomUUID();

    const [createResult] = await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "time_entries",
        entityId: timeEntryId,
        op: "create",
        changes: { projectId: project.id, userId: ownerId, costCodeId: costCode.id, hours: 8, workDate: "2026-07-20", kind: "regular" },
        capturedAt: capturedNow(),
      },
    ]);
    expect(createResult.result).toBe("applied");

    const [updateResult] = await syncMutationsService.applyBatch(tenantId, ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "time_entries",
        entityId: timeEntryId,
        op: "update",
        changes: { hours: 9 },
        capturedAt: capturedNow(),
      },
    ]);
    expect(updateResult.result).toBe("rejected");
  });

  it("delta: pulling scopes=tasks,daily_reports returns both, and an unrequested scope stays empty", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("dr-delta");
    await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "A task" });
    await dailyReportsService.create(tenantId, ownerId, { projectId: project.id, reportDate: "2026-07-20" });

    const pull = await syncDeltaService.getDelta(tenantId, ownerId, 0, ["tasks", "daily_reports"]);
    expect(pull.tasks).toHaveLength(1);
    expect(pull.dailyReports).toHaveLength(1);
    expect(pull.timeEntries).toHaveLength(0); // not in requested scopes
  });

  it("working-set: returns the caller's assigned projects", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("working-set");
    const workingSet = await syncWorkingSetService.getWorkingSet(tenantId, ownerId);
    expect(workingSet.projects.map((p) => p.id)).toContain(project.id);
    expect(workingSet.drawingSet).toBeNull();
  });

  it("RLS: a tenant only sees its own sync_mutations", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await syncMutationsService.applyBatch(a.tenantId, a.ownerId, [
      {
        mutationId: randomUUID(),
        clientId: "device-1",
        entity: "tasks",
        entityId: randomUUID(),
        op: "create",
        changes: { projectId: a.project.id, title: "A-only" },
        capturedAt: capturedNow(),
      },
    ]);

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.syncMutations.findMany());
    expect(rowsB).toHaveLength(0);

    const rowsA = await withTenant(db, a.tenantId, (tx) => tx.query.syncMutations.findMany());
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });
});
