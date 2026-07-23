import { Inject, Injectable } from "@nestjs/common";
import type { CreateRfqInput, CreateSupplierQuoteInput, ListRfqsQuery } from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects, rfqLines, rfqs, supplierQuotes } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ProjectNotFoundError, RfqLineNotFoundError, RfqNotFoundError } from "../domain/errors";
import { SuppliersService } from "./suppliers.service";

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

// database.md §12 (M5): "Quote workflow feeding PO creation and
// cost_item_price_history." — the cost_item_price_history feed isn't
// wired (PO/RFQ lines are cost-code-scoped, not cost-book-item-scoped;
// there's no natural join key without inventing one — flagged as a
// follow-up, same "flag it, don't invent" precedent as every other
// cross-module gap this session). number is per-project (change_orders/
// rfis convention).
@Injectable()
export class RfqsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly suppliers: SuppliersService,
  ) {}

  async list(tenantId: string, query: ListRfqsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(rfqs.deletedAt)];
      if (query.projectId) conditions.push(eq(rfqs.projectId, query.projectId));
      if (query.status) conditions.push(eq(rfqs.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(lt(rfqs.createdAt, new Date(c.createdAt)), and(eq(rfqs.createdAt, new Date(c.createdAt)), lt(rfqs.id, c.id))!)!,
        );
      }

      const rows = await tx.query.rfqs.findMany({
        where: and(...conditions),
        orderBy: [desc(rfqs.createdAt), desc(rfqs.id)],
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
    return withTenant(this.db, tenantId, async (tx) => {
      const rfq = await this.requireRfq(tx, id);
      const lines = await tx.query.rfqLines.findMany({
        where: and(eq(rfqLines.rfqId, id), isNull(rfqLines.deletedAt)),
      });
      return { ...rfq, lines };
    });
  }

  async create(tenantId: string, actorId: string, input: CreateRfqInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      if (!project) throw new ProjectNotFoundError();

      const [maxNumberRow] = await tx
        .select({ maxNumber: sql<number | null>`max(${rfqs.number})` })
        .from(rfqs)
        .where(eq(rfqs.projectId, input.projectId));
      const number = (maxNumberRow!.maxNumber ?? 0) + 1;

      const [rfq] = await tx
        .insert(rfqs)
        .values({
          tenantId,
          projectId: input.projectId,
          number,
          title: input.title,
          dueDate: input.dueDate,
          notes: input.notes,
          createdBy: actorId,
        })
        .returning();
      const created = rfq!;

      const insertedLines = await tx
        .insert(rfqLines)
        .values(
          input.lines.map((line) => ({
            tenantId,
            rfqId: created.id,
            description: line.description,
            costCodeId: line.costCodeId,
            qty: line.qty,
            uom: line.uom,
            createdBy: actorId,
          })),
        )
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "rfq.created.v1",
        dedupeKey: `rfq.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: input.projectId, rfqId: created.id, number },
      });

      return { ...created, lines: insertedLines };
    });
  }

  async listQuotes(tenantId: string, rfqId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireRfq(tx, rfqId);
      return tx.query.supplierQuotes.findMany({
        where: and(eq(supplierQuotes.rfqId, rfqId), isNull(supplierQuotes.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.unitCostAmount)],
      });
    });
  }

  async createQuote(tenantId: string, actorId: string, rfqId: string, input: CreateSupplierQuoteInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireRfq(tx, rfqId);
      const line = await tx.query.rfqLines.findFirst({
        where: and(eq(rfqLines.id, input.rfqLineId), eq(rfqLines.rfqId, rfqId), isNull(rfqLines.deletedAt)),
      });
      if (!line) throw new RfqLineNotFoundError();
      await this.suppliers.requireSupplier(tx, input.supplierId);

      const [quote] = await tx
        .insert(supplierQuotes)
        .values({
          tenantId,
          rfqId,
          rfqLineId: input.rfqLineId,
          supplierId: input.supplierId,
          unitCostAmount: input.unitCostAmount,
          leadTimeDays: input.leadTimeDays,
          notes: input.notes,
          createdBy: actorId,
        })
        .returning();
      const created = quote!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "supplier_quote.created.v1",
        dedupeKey: `supplier_quote.created.v1:${created.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          rfqId,
          rfqLineId: input.rfqLineId,
          supplierQuoteId: created.id,
          supplierId: input.supplierId,
        },
      });

      return created;
    });
  }

  private async requireRfq(tx: Database, id: string) {
    const row = await tx.query.rfqs.findFirst({ where: and(eq(rfqs.id, id), isNull(rfqs.deletedAt)) });
    if (!row) throw new RfqNotFoundError();
    return row;
  }
}
