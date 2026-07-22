import { Inject, Injectable } from "@nestjs/common";
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from "@constructionos/schemas";
import { and, desc, eq, gte, isNull, lte, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects, tasks } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ProjectNotFoundError, TaskNotFoundError, VersionConflictError } from "../domain/errors";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// api.md §7: tasks live at a flat /tasks (not nested under /projects/{id}).
@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  // "Filter: project_id, assignee_id, status, kind, due window" — "me" is
  // resolved to the caller's own id by the controller before this runs.
  async list(tenantId: string, query: ListTasksQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(tasks.deletedAt)];
      if (query.projectId) conditions.push(eq(tasks.projectId, query.projectId));
      if (query.assigneeId) conditions.push(eq(tasks.assigneeId, query.assigneeId));
      if (query.status) conditions.push(eq(tasks.status, query.status));
      if (query.kind) conditions.push(eq(tasks.kind, query.kind));
      if (query.dueBefore) conditions.push(lte(tasks.dueDate, query.dueBefore));
      if (query.dueAfter) conditions.push(gte(tasks.dueDate, query.dueAfter));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(lt(tasks.createdAt, new Date(c.createdAt)), and(eq(tasks.createdAt, new Date(c.createdAt)), lt(tasks.id, c.id))!)!,
        );
      }

      const rows = await tx.query.tasks.findMany({
        where: and(...conditions),
        orderBy: [desc(tasks.createdAt), desc(tasks.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, taskId: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireTask(tx, taskId));
  }

  async create(tenantId: string, actorId: string, input: CreateTaskInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      if (!project) throw new ProjectNotFoundError();

      const [task] = await tx
        .insert(tasks)
        .values({
          tenantId,
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          priority: input.priority,
          dueDate: input.dueDate,
          assigneeId: input.assigneeId,
          kind: input.kind,
          locationDocumentVersionId: input.locationDocumentVersionId,
          locationX: input.locationX?.toString(),
          locationY: input.locationY?.toString(),
          scheduleActivityId: input.scheduleActivityId,
          rfiId: input.rfiId,
          checklist: input.checklist,
          createdBy: actorId,
        })
        .returning();
      const created = task!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "task.created.v1",
        dedupeKey: `task.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: input.projectId, taskId: created.id, kind: created.kind },
      });

      return created;
    });
  }

  async update(tenantId: string, actorId: string, taskId: string, input: UpdateTaskInput, ifMatchVersion?: number) {
    return withTenant(this.db, tenantId, async (tx) => {
      const current = await this.requireTask(tx, taskId);

      if (ifMatchVersion !== undefined && current.updatedSeq !== ifMatchVersion) {
        throw new VersionConflictError();
      }

      const changedFields = Object.keys(input).filter(
        (key) => (input as Record<string, unknown>)[key] !== undefined,
      );

      const [updated] = await tx
        .update(tasks)
        .set({
          ...input,
          locationX: input.locationX === undefined ? undefined : input.locationX?.toString() ?? null,
          locationY: input.locationY === undefined ? undefined : input.locationY?.toString() ?? null,
          updatedBy: actorId,
        })
        .where(and(eq(tasks.id, taskId), eq(tasks.updatedSeq, current.updatedSeq)))
        .returning();

      if (!updated) throw new VersionConflictError();

      if (changedFields.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "task.updated.v1",
          dedupeKey: `task.updated.v1:${taskId}:${updated.updatedSeq}`,
          actorId,
          payload: { companyId: tenantId, projectId: current.projectId, taskId, changedFields },
        });
      }

      return updated;
    });
  }

  async remove(tenantId: string, actorId: string, taskId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const current = await this.requireTask(tx, taskId);

      await tx
        .update(tasks)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(tasks.id, taskId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "task.deleted.v1",
        dedupeKey: `task.deleted.v1:${taskId}`,
        actorId,
        payload: { companyId: tenantId, projectId: current.projectId, taskId },
      });
    });
  }

  private async requireTask(tx: Database, taskId: string) {
    const task = await tx.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)) });
    if (!task) throw new TaskNotFoundError();
    return task;
  }
}
