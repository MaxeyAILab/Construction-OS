import { Inject, Injectable } from "@nestjs/common";
import type { CreateIncidentInput, ListIncidentsQuery, RouteIncidentCorrectiveActionInput, UpdateIncidentInput } from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { incidents, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { TasksService } from "../../tasks";
import { IncidentAlreadyRoutedError, IncidentNotFoundError, ProjectNotFoundError } from "../domain/errors";

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

// database.md §15 (M12): "incidents ... corrective_action_task_id NULL
// (FR-SAFE-3), OSHA-recordable flag." spec.md §M12: "Integrations:
// incidents route to Tasks and management." "Management notification" is
// served as this pull-based feed (filterable by severity/status) rather
// than a push fan-out — see the schema file's doc comment for why.
@Injectable()
export class IncidentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly tasks: TasksService,
  ) {}

  async listForProject(tenantId: string, projectId: string, query: ListIncidentsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [eq(incidents.projectId, projectId), isNull(incidents.deletedAt)];
      if (query.kind) conditions.push(eq(incidents.kind, query.kind));
      if (query.severity) conditions.push(eq(incidents.severity, query.severity));
      if (query.status) conditions.push(eq(incidents.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(incidents.createdAt, new Date(c.createdAt)),
            and(eq(incidents.createdAt, new Date(c.createdAt)), lt(incidents.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.incidents.findMany({
        where: and(...conditions),
        orderBy: [desc(incidents.createdAt), desc(incidents.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireIncident(tx, id));
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateIncidentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      const [created] = await tx
        .insert(incidents)
        .values({
          tenantId,
          projectId,
          kind: input.kind,
          severity: input.severity,
          occurredAt: new Date(input.occurredAt),
          location: input.location,
          description: input.description,
          people: input.people,
          oshaRecordable: input.oshaRecordable,
          createdBy: actorId,
        })
        .returning();
      const incident = created!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "incident.reported.v1",
        dedupeKey: `incident.reported.v1:${incident.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId,
          incidentId: incident.id,
          kind: incident.kind,
          severity: incident.severity,
        },
      });

      return incident;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateIncidentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await this.requireIncident(tx, id);

      const [updated] = await tx
        .update(incidents)
        .set({ ...input, updatedBy: actorId })
        .where(eq(incidents.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "incident.updated.v1",
        dedupeKey: `incident.updated.v1:${id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, projectId: existing.projectId, incidentId: id, changedFields: Object.keys(input) },
      });

      return updated!;
    });
  }

  // FR-SAFE-3: "route incidents to corrective actions" — creates a Task
  // via TasksService (tasks/index.ts's public surface — cross-module
  // reuse, same "broaden an existing module's public surface" precedent
  // as postFromTimeEntry/postFromInventoryIssue) in its own transaction,
  // then stamps corrective_action_task_id as a second write — same two-
  // phase-write looseness this session accepts elsewhere.
  async routeCorrectiveAction(
    tenantId: string,
    actorId: string,
    id: string,
    input: RouteIncidentCorrectiveActionInput,
  ) {
    const incident = await withTenant(this.db, tenantId, (tx) => this.requireIncident(tx, id));
    if (incident.correctiveActionTaskId) throw new IncidentAlreadyRoutedError();

    const task = await this.tasks.create(tenantId, actorId, {
      projectId: incident.projectId,
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
    });

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(incidents)
        .set({ correctiveActionTaskId: task.id, updatedBy: actorId })
        .where(eq(incidents.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "incident.updated.v1",
        dedupeKey: `incident.updated.v1:${id}:corrective_action:${task.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: incident.projectId,
          incidentId: id,
          changedFields: ["correctiveActionTaskId"],
        },
      });

      return updated!;
    });
  }

  private async requireIncident(tx: Database, id: string) {
    const row = await tx.query.incidents.findFirst({
      where: and(eq(incidents.id, id), isNull(incidents.deletedAt)),
    });
    if (!row) throw new IncidentNotFoundError();
    return row;
  }
}
