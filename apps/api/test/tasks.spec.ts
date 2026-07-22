import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { notifications, outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestCommentsServices } from "./setup/comments";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestNotificationsServices } from "./setup/notifications";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestTasksServices } from "./setup/tasks";

describe("Tasks & Punch", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { tasksService } = buildTestTasksServices(db);
  const { commentsService } = buildTestCommentsServices(db);
  const { dispatchService } = buildTestNotificationsServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `task-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Task ${label} ${suffix}`,
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

  it("creates a task and a punch item, filtering by kind", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("crud");
    const task = await tasksService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Frame second floor",
    });
    expect(task.status).toBe("todo");
    expect(task.kind).toBe("task");
    expect(task.priority).toBe("medium");

    const punch = await tasksService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Touch up paint in unit 4B",
      kind: "punch",
    });
    expect(punch.kind).toBe("punch");

    const onlyPunch = await tasksService.list(tenantId, { limit: 20, kind: "punch" });
    expect(onlyPunch.data).toHaveLength(1);
    expect(onlyPunch.data[0]!.id).toBe(punch.id);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("task.created.v1");
  });

  it("updates a task with If-Match optimistic locking, rejecting a stale version", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("ifmatch");
    const task = await tasksService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Pour footings",
    });

    const updated = await tasksService.update(
      tenantId,
      ownerId,
      task.id,
      { status: "in_progress" },
      task.updatedSeq,
    );
    expect(updated.status).toBe("in_progress");

    await expect(
      tasksService.update(tenantId, ownerId, task.id, { status: "done" }, task.updatedSeq),
    ).rejects.toThrow(/modified since it was last read/);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("task.updated.v1");
  });

  it("soft-deletes a task, removing it from list/getById", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("delete");
    const task = await tasksService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Temporary task",
    });

    await tasksService.remove(tenantId, ownerId, task.id);

    await expect(tasksService.getById(tenantId, task.id)).rejects.toThrow(/not found/);
    const list = await tasksService.list(tenantId, { limit: 20, projectId: project.id });
    expect(list.data).toHaveLength(0);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("task.deleted.v1");
  });

  it("comments: creates a comment with mentions, fanning out to one notification per mentioned user", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("comments");
    const task = await tasksService.create(tenantId, ownerId, {
      projectId: project.id,
      title: "Needs review",
    });

    const other = await signUpCompanyWithProject("comments-mentioned");
    const comment = await commentsService.create(tenantId, ownerId, "task", task.id, {
      body: "Can someone take a look?",
      mentions: [ownerId, other.ownerId],
    });
    expect(comment.mentions).toEqual([ownerId, other.ownerId]);

    const list = await commentsService.list(tenantId, "task", task.id);
    expect(list).toHaveLength(1);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("comment.created.v1");

    await dispatchService.handleEnvelope({
      id: comment.id,
      tenantId,
      eventType: "comment.created.v1",
      payload: { companyId: tenantId, entityType: "task", entityId: task.id, commentId: comment.id, mentions: comment.mentions },
      dedupeKey: `comment.created.v1:${comment.id}`,
      occurredAt: new Date().toISOString(),
      actorId: ownerId,
      actorType: "user",
    });

    const notifRows = await withTenant(db, tenantId, (tx) =>
      tx.query.notifications.findMany({ where: eq(notifications.tenantId, tenantId) }),
    );
    expect(notifRows).toHaveLength(2);
    expect(notifRows.map((r) => r.userId).sort()).toEqual([ownerId, other.ownerId].sort());
    expect(notifRows.every((r) => r.kind === "comment_mention")).toBe(true);
  });

  it("RLS: a tenant only sees its own tasks and comments", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const task = await tasksService.create(a.tenantId, a.ownerId, { projectId: a.project.id, title: "A task" });
    await commentsService.create(a.tenantId, a.ownerId, "task", task.id, { body: "hi" });

    const tasksB = await withTenant(db, b.tenantId, (tx) => tx.query.tasks.findMany());
    expect(tasksB).toHaveLength(0);

    const commentsB = await withTenant(db, b.tenantId, (tx) => tx.query.comments.findMany());
    expect(commentsB).toHaveLength(0);
  });
});
