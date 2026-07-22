import { Inject, Injectable } from "@nestjs/common";
import type { CreateRfiInput, ListRfisQuery, RfiStatus, UpdateRfiInput } from "@constructionos/schemas";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects, rfis } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { IllegalRfiTransitionError, ProjectNotFoundError, RfiAnswerRequiredError, RfiNotFoundError } from "../domain/errors";

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

// api.md §8: "status machine enforced" — draft -> open -> answered ->
// closed, with void reachable from any non-terminal state. closed/void are
// terminal (matches Change Orders' identical draft/pending_client/
// approved-or-rejected/void shape).
const ALLOWED_TRANSITIONS: Record<RfiStatus, RfiStatus[]> = {
  draft: ["open", "void"],
  open: ["answered", "closed", "void"],
  answered: ["closed", "void"],
  closed: [],
  void: [],
};

@Injectable()
export class RfisService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string, query: ListRfisQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [eq(rfis.projectId, projectId)];
      if (query.status) conditions.push(eq(rfis.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(lt(rfis.createdAt, new Date(c.createdAt)), and(eq(rfis.createdAt, new Date(c.createdAt)), lt(rfis.id, c.id))!)!,
        );
      }

      const rows = await tx.query.rfis.findMany({
        where: and(...conditions),
        orderBy: [desc(rfis.createdAt), desc(rfis.id)],
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

  async getById(tenantId: string, rfiId: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireRfi(tx, rfiId));
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateRfiInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      const [maxNumberRow] = await tx
        .select({ maxNumber: sql<number | null>`max(${rfis.number})` })
        .from(rfis)
        .where(eq(rfis.projectId, projectId));
      const number = (maxNumberRow!.maxNumber ?? 0) + 1;

      const [rfi] = await tx
        .insert(rfis)
        .values({
          tenantId,
          projectId,
          number,
          subject: input.subject,
          question: input.question,
          assignedToContactId: input.assignedToContactId,
          dueDate: input.dueDate,
          costImpactFlag: input.costImpactFlag,
          scheduleImpactFlag: input.scheduleImpactFlag,
          linkedActivityId: input.linkedActivityId,
          linkedDrawingRef: input.linkedDrawingRef,
          createdBy: actorId,
        })
        .returning();
      const created = rfi!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "rfi.created.v1",
        dedupeKey: `rfi.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, rfiId: created.id, number },
      });

      return created;
    });
  }

  async update(tenantId: string, actorId: string, rfiId: string, input: UpdateRfiInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await this.requireRfi(tx, rfiId);

      if (input.status && input.status !== existing.status) {
        const allowed = ALLOWED_TRANSITIONS[existing.status as RfiStatus];
        if (!allowed.includes(input.status)) {
          throw new IllegalRfiTransitionError(existing.status, input.status);
        }
        if (input.status === "answered" && !(input.answer ?? existing.answer)) {
          throw new RfiAnswerRequiredError();
        }
      }

      const [updated] = await tx
        .update(rfis)
        .set({ ...input, updatedBy: actorId })
        .where(eq(rfis.id, rfiId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "rfi.updated.v1",
        dedupeKey: `rfi.updated.v1:${rfiId}:${updated!.updatedSeq}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: existing.projectId,
          rfiId,
          changedFields: Object.keys(input),
        },
      });

      return updated!;
    });
  }

  private async requireRfi(tx: Database, rfiId: string) {
    const rfi = await tx.query.rfis.findFirst({ where: eq(rfis.id, rfiId) });
    if (!rfi) throw new RfiNotFoundError();
    return rfi;
  }
}
