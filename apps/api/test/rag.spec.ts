import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { embeddings } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRagServices } from "./setup/rag";
import { buildTestRbacServices } from "./setup/rbac";

describe("RAG pipeline + NL search v1: chunk/embed/index, hybrid retrieval, permission filtering", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const { ragIndexingService, ragSearchService, tasksService, rfisService, dailyReportsService, cacheRedis } =
    buildTestRagServices(db);

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
      email: `rag-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `RAG ${label} ${suffix}`,
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

  async function embeddingRows(tenantId: string, entityType: string, entityId: string) {
    return withTenant(db, tenantId, (tx) =>
      tx.query.embeddings.findMany({
        where: and(eq(embeddings.tenantId, tenantId), eq(embeddings.entityType, entityType), eq(embeddings.entityId, entityId)),
      }),
    );
  }

  it("indexes a task: creates an embeddings row with the right meta (title, projectId)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("index");
    const task = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Inspect roof leak on level 3" });

    await ragIndexingService.indexEntity(tenantId, "task", task.id);

    const rows = await embeddingRows(tenantId, "task", task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toContain("Inspect roof leak on level 3");
    expect((rows[0]!.meta as { title: string }).title).toBe("Inspect roof leak on level 3");
    expect((rows[0]!.meta as { projectId: string }).projectId).toBe(project.id);
  });

  it("re-indexing after a content change replaces the old chunk rather than accumulating", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("reindex");
    const task = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Original title" });
    await ragIndexingService.indexEntity(tenantId, "task", task.id);

    await tasksService.update(tenantId, ownerId, task.id, { title: "Updated title after edit" }, task.updatedSeq);
    await ragIndexingService.indexEntity(tenantId, "task", task.id);

    const rows = await embeddingRows(tenantId, "task", task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toContain("Updated title after edit");
    expect(rows[0]!.content).not.toContain("Original title");
  });

  it("removeEntity purges every chunk for that entity (tombstone)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("remove");
    const task = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Task to be removed" });
    await ragIndexingService.indexEntity(tenantId, "task", task.id);
    expect(await embeddingRows(tenantId, "task", task.id)).toHaveLength(1);

    await ragIndexingService.removeEntity(tenantId, "task", task.id);
    expect(await embeddingRows(tenantId, "task", task.id)).toHaveLength(0);
  });

  it("indexing an unindexed entity type is a silent no-op, not an error", async () => {
    const { tenantId } = await signUpCompanyWithProject("noop");
    await expect(ragIndexingService.indexEntity(tenantId, "invoice", "00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });

  it("search: finds textually relevant content across entity types, permission-filtered to what the caller can read", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("search");
    const roofTask = await tasksService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Inspect roof leak near the north stairwell",
    });
    const drywallTask = await tasksService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Order drywall sheets for level 2 framing",
    });
    const rfi = await rfisService.create(tenantId, ownerId, project.id, {
      subject: "Roof membrane spec clarification",
      question: "Which roofing membrane thickness applies at the parapet flashing detail?",
    });
    await ragIndexingService.indexEntity(tenantId, "task", roofTask.id);
    await ragIndexingService.indexEntity(tenantId, "task", drywallTask.id);
    await ragIndexingService.indexEntity(tenantId, "rfi", rfi.id);

    const results = await ragSearchService.search(tenantId, ownerId, { query: "roof leak membrane" });

    const entityIds = results.map((r) => r.entityId);
    expect(entityIds).toContain(roofTask.id);
    expect(entityIds).toContain(rfi.id);
    // The roof-related items should outrank the unrelated drywall task.
    const drywallIndex = entityIds.indexOf(drywallTask.id);
    const roofIndex = entityIds.indexOf(roofTask.id);
    if (drywallIndex !== -1) expect(roofIndex).toBeLessThan(drywallIndex);
    expect(results.every((r) => r.snippet.length > 0)).toBe(true);
  });

  it("search: a caller with no read permission for the matching entity type gets zero results (the load-bearing security property)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("permission-leak");
    const task = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Confidential punch item about wiring defect" });
    await ragIndexingService.indexEntity(tenantId, "task", task.id);

    const bystander = await rbacService.inviteUser(tenantId, `rag-bystander-${Date.now()}@example.com`, "Bystander", ownerId);
    // No role assigned -> zero permissions (RBAC's own documented default).
    const results = await ragSearchService.search(tenantId, bystander.userId, { query: "wiring defect" });

    expect(results).toEqual([]);
  });

  it("search: scope.projectId narrows results to a single project", async () => {
    const { tenantId, ownerId, project: projectA } = await signUpCompanyWithProject("scope-a");
    const signUpB = await projectsService.create(tenantId, ownerId, {
      name: "Scope B Project",
      code: "SCOPEB-1",
      currency: "USD",
      contractValueAmount: "500000.00",
    });

    const taskA = await tasksService.create(tenantId, ownerId, { projectId: projectA.id, title: "Roof leak inspection" });
    const taskB = await tasksService.create(tenantId, ownerId, { projectId: signUpB.id, title: "Roof leak inspection" });
    await ragIndexingService.indexEntity(tenantId, "task", taskA.id);
    await ragIndexingService.indexEntity(tenantId, "task", taskB.id);

    const results = await ragSearchService.search(tenantId, ownerId, {
      query: "roof leak inspection",
      scope: { projectId: projectA.id },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.entityId !== taskB.id)).toBe(true);
    expect(results.some((r) => r.entityId === taskA.id)).toBe(true);
  });

  it("daily reports are indexable too (structured-to-text rendering)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("daily-report");
    const report = await dailyReportsService.create(tenantId, ownerId, {
      projectId: project.id,
      reportDate: "2026-07-20",
      narrative: "Crew poured the level 3 slab this morning; minor rain delay after lunch.",
    });

    await ragIndexingService.indexEntity(tenantId, "daily_report", report.id);
    const rows = await embeddingRows(tenantId, "daily_report", report.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toContain("slab");
  });

  it("RLS: a tenant only sees its own embeddings", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const taskA = await tasksService.create(a.tenantId, a.ownerId, { projectId: a.project.id, title: "A-only task content" });
    await ragIndexingService.indexEntity(a.tenantId, "task", taskA.id);

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.embeddings.findMany());
    expect(rowsB).toHaveLength(0);

    const rowsA = await withTenant(db, a.tenantId, (tx) => tx.query.embeddings.findMany({ where: eq(embeddings.tenantId, a.tenantId) }));
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });
});
