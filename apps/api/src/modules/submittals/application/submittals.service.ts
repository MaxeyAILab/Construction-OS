import { Inject, Injectable } from "@nestjs/common";
import type { CreateSubmittalInput, ListSubmittalsQuery, SubmittalStatus, UpdateSubmittalInput } from "@constructionos/schemas";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { documents, projects, submittals } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  DocumentNotOnProjectError,
  IllegalSubmittalTransitionError,
  ProjectNotFoundError,
  SubmittalNotFoundError,
} from "../domain/errors";

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

// database.md §16 (FR-DOC-4): "status workflow (draft→submitted→
// reviewed→approved/rejected/resubmit)" — a literal linear chain that
// branches at 'reviewed' into the reviewer's decision, with 'resubmit'
// cycling back to 'submitted' for the next round (same "cycle back on
// revision request" shape as real AEC submittal logs). approved/rejected
// are terminal.
const ALLOWED_TRANSITIONS: Record<SubmittalStatus, SubmittalStatus[]> = {
  draft: ["submitted"],
  submitted: ["reviewed"],
  reviewed: ["approved", "rejected", "resubmit"],
  resubmit: ["submitted"],
  approved: [],
  rejected: [],
};

@Injectable()
export class SubmittalsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string, query: ListSubmittalsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [eq(submittals.projectId, projectId)];
      if (query.status) conditions.push(eq(submittals.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(submittals.createdAt, new Date(c.createdAt)),
            and(eq(submittals.createdAt, new Date(c.createdAt)), lt(submittals.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.submittals.findMany({
        where: and(...conditions),
        orderBy: [desc(submittals.createdAt), desc(submittals.id)],
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

  async getById(tenantId: string, submittalId: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireSubmittal(tx, submittalId));
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateSubmittalInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      const document = await tx.query.documents.findFirst({ where: eq(documents.id, input.documentId) });
      if (!document || document.projectId !== projectId) throw new DocumentNotOnProjectError();

      const [maxNumberRow] = await tx
        .select({ maxNumber: sql<number | null>`max(${submittals.number})` })
        .from(submittals)
        .where(eq(submittals.projectId, projectId));
      const number = (maxNumberRow!.maxNumber ?? 0) + 1;

      const [submittal] = await tx
        .insert(submittals)
        .values({
          tenantId,
          projectId,
          number,
          specSection: input.specSection,
          title: input.title,
          documentId: input.documentId,
          reviewerContactId: input.reviewerContactId,
          dueDate: input.dueDate,
          createdBy: actorId,
        })
        .returning();
      const created = submittal!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "submittal.created.v1",
        dedupeKey: `submittal.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, submittalId: created.id, number },
      });

      return created;
    });
  }

  async update(tenantId: string, actorId: string, submittalId: string, input: UpdateSubmittalInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await this.requireSubmittal(tx, submittalId);

      if (input.status && input.status !== existing.status) {
        const allowed = ALLOWED_TRANSITIONS[existing.status as SubmittalStatus];
        if (!allowed.includes(input.status)) {
          throw new IllegalSubmittalTransitionError(existing.status, input.status);
        }
      }

      const [updated] = await tx
        .update(submittals)
        .set({ ...input, updatedBy: actorId })
        .where(eq(submittals.id, submittalId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "submittal.updated.v1",
        dedupeKey: `submittal.updated.v1:${submittalId}:${updated!.updatedSeq}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: existing.projectId,
          submittalId,
          changedFields: Object.keys(input),
        },
      });

      return updated!;
    });
  }

  private async requireSubmittal(tx: Database, submittalId: string) {
    const submittal = await tx.query.submittals.findFirst({ where: eq(submittals.id, submittalId) });
    if (!submittal) throw new SubmittalNotFoundError();
    return submittal;
  }
}
