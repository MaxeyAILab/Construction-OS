import { Inject, Injectable } from "@nestjs/common";
import type { CreateSubcontractorInput, ListSubcontractorsQuery, UpdateSubcontractorInput } from "@constructionos/schemas";
import { and, arrayContains, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { subcontractors } from "../../../infrastructure/db/schema";
import { CertificationsService } from "../../safety";
import { OutboxService } from "../../events";
import { SubcontractorIneligibleError, SubcontractorNotFoundError } from "../domain/errors";

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

// database.md §17 (M14): "Company-level registry" (FR-SUB-1).
@Injectable()
export class SubcontractorsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly certifications: CertificationsService,
  ) {}

  async list(tenantId: string, query: ListSubcontractorsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(subcontractors.deletedAt)];
      if (query.prequalStatus) conditions.push(eq(subcontractors.prequalStatus, query.prequalStatus));
      if (query.trade) conditions.push(arrayContains(subcontractors.trades, [query.trade]));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(subcontractors.createdAt, new Date(c.createdAt)),
            and(eq(subcontractors.createdAt, new Date(c.createdAt)), lt(subcontractors.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.subcontractors.findMany({
        where: and(...conditions),
        orderBy: [desc(subcontractors.createdAt), desc(subcontractors.id)],
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
    return withTenant(this.db, tenantId, (tx) => this.requireSubcontractor(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateSubcontractorInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(subcontractors)
        .values({
          tenantId,
          name: input.name,
          trades: input.trades,
          contact: input.contact,
          prequalStatus: input.prequalStatus,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "subcontractor.created.v1",
        dedupeKey: `subcontractor.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, subcontractorId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateSubcontractorInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireSubcontractor(tx, id);

      const [updated] = await tx
        .update(subcontractors)
        .set({ ...input, updatedBy: actorId })
        .where(eq(subcontractors.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "subcontractor.updated.v1",
        dedupeKey: `subcontractor.updated.v1:${id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, subcontractorId: id, changedFields: Object.keys(input) },
      });

      return updated!;
    });
  }

  // FR-SUB-2: "eligibility gating" — called by SubcontractsService.create()
  // and (cross-module, via subcontractors/index.ts's public surface)
  // Estimating's BidInvitationsService.create().
  async requireEligible(tenantId: string, subcontractorId: string) {
    const ineligible = await this.certifications.hasExpiredCompliance(tenantId, subcontractorId);
    if (ineligible) throw new SubcontractorIneligibleError();
  }

  async requireSubcontractor(tx: Database, id: string) {
    const row = await tx.query.subcontractors.findFirst({
      where: and(eq(subcontractors.id, id), isNull(subcontractors.deletedAt)),
    });
    if (!row) throw new SubcontractorNotFoundError();
    return row;
  }
}
