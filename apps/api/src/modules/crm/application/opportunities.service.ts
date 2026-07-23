import { Inject, Injectable } from "@nestjs/common";
import type { CreateOpportunityInput, ListOpportunitiesQuery, UpdateOpportunityInput } from "@constructionos/schemas";
import { and, desc, eq, gte, isNull, lte, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { opportunities } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { OpportunityNotFoundError } from "../domain/errors";

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

// database.md §8 (M1): "deals in pipeline." Win/lose lifecycle lives in
// OpportunityLifecycleService — this service is header CRUD + list only,
// same "CRUD vs lifecycle" split as ChangeOrdersService/
// ChangeOrderLifecycleService.
@Injectable()
export class OpportunitiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListOpportunitiesQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(opportunities.deletedAt)];
      if (query.stageId) conditions.push(eq(opportunities.stageId, query.stageId));
      if (query.status) conditions.push(eq(opportunities.status, query.status));
      if (query.closeDateBefore) conditions.push(lte(opportunities.expectedCloseDate, query.closeDateBefore));
      if (query.closeDateAfter) conditions.push(gte(opportunities.expectedCloseDate, query.closeDateAfter));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(opportunities.createdAt, new Date(c.createdAt)),
            and(eq(opportunities.createdAt, new Date(c.createdAt)), lt(opportunities.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.opportunities.findMany({
        where: and(...conditions),
        orderBy: [desc(opportunities.createdAt), desc(opportunities.id)],
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
    return withTenant(this.db, tenantId, (tx) => this.requireOpportunity(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateOpportunityInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(opportunities)
        .values({ tenantId, ...input, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "opportunity.created.v1",
        dedupeKey: `opportunity.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, opportunityId: created!.id },
      });

      return created!;
    });
  }

  // api.md §4: "Stage moves audited" — this same generic PATCH covers a
  // stage move and any other header edit, one changedFields-carrying
  // event, same reasoning as project.updated.v1.
  async update(tenantId: string, actorId: string, id: string, input: UpdateOpportunityInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireOpportunity(tx, id);

      const changedFields = Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined);

      const [updated] = await tx
        .update(opportunities)
        .set({ ...input, updatedBy: actorId })
        .where(eq(opportunities.id, id))
        .returning();

      if (changedFields.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "opportunity.updated.v1",
          dedupeKey: `opportunity.updated.v1:${id}:${updated!.updatedSeq}`,
          actorId,
          payload: { companyId: tenantId, opportunityId: id, changedFields },
        });
      }

      return updated!;
    });
  }

  private async requireOpportunity(tx: Database, id: string) {
    const row = await tx.query.opportunities.findFirst({ where: and(eq(opportunities.id, id), isNull(opportunities.deletedAt)) });
    if (!row) throw new OpportunityNotFoundError();
    return row;
  }
}
