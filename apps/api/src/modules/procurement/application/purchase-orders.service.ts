import { Inject, Injectable } from "@nestjs/common";
import type {
  CreatePurchaseOrderInput,
  CreatePurchaseOrderLineInput,
  ListPurchaseOrdersQuery,
  UpdatePurchaseOrderInput,
  UpdatePurchaseOrderLineInput,
} from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes, projects, purchaseOrderLines, purchaseOrders } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  CostCodeNotOnProjectError,
  ProjectNotFoundError,
  PurchaseOrderNotDraftError,
  PurchaseOrderNotFoundError,
} from "../domain/errors";
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

// database.md §12 (M5); api.md §11. number is auto-assigned tenant-wide
// (ux (tenant_id, number), unlike change_orders/rfis which number
// per-project) — same "max+1 at creation" convention, scoped to the
// tenant instead.
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly suppliers: SuppliersService,
  ) {}

  async list(tenantId: string, query: ListPurchaseOrdersQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(purchaseOrders.deletedAt)];
      if (query.projectId) conditions.push(eq(purchaseOrders.projectId, query.projectId));
      if (query.supplierId) conditions.push(eq(purchaseOrders.supplierId, query.supplierId));
      if (query.status) conditions.push(eq(purchaseOrders.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(purchaseOrders.createdAt, new Date(c.createdAt)),
            and(eq(purchaseOrders.createdAt, new Date(c.createdAt)), lt(purchaseOrders.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.purchaseOrders.findMany({
        where: and(...conditions),
        orderBy: [desc(purchaseOrders.createdAt), desc(purchaseOrders.id)],
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
      const po = await this.requirePurchaseOrder(tx, id);
      const lines = await tx.query.purchaseOrderLines.findMany({
        where: and(eq(purchaseOrderLines.purchaseOrderId, id), isNull(purchaseOrderLines.deletedAt)),
      });
      return { ...po, lines };
    });
  }

  async create(tenantId: string, actorId: string, input: CreatePurchaseOrderInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      if (!project) throw new ProjectNotFoundError();
      await this.suppliers.requireSupplier(tx, input.supplierId);

      for (const line of input.lines) {
        const costCode = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.id, line.costCodeId), eq(costCodes.projectId, input.projectId)),
        });
        if (!costCode) throw new CostCodeNotOnProjectError();
      }

      const [maxNumberRow] = await tx
        .select({ maxNumber: sql<number | null>`max(${purchaseOrders.number})` })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.tenantId, tenantId));
      const number = (maxNumberRow!.maxNumber ?? 0) + 1;

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId,
          projectId: input.projectId,
          supplierId: input.supplierId,
          number,
          requiredByDate: input.requiredByDate,
          shipTo: input.shipTo,
          currency: input.currency ?? "USD",
          createdBy: actorId,
        })
        .returning();
      const created = po!;

      await tx.insert(purchaseOrderLines).values(
        input.lines.map((line) => ({
          tenantId,
          purchaseOrderId: created.id,
          description: line.description,
          costCodeId: line.costCodeId,
          inventoryItemId: line.inventoryItemId,
          qtyOrdered: line.qtyOrdered,
          uom: line.uom,
          unitCostAmount: line.unitCostAmount,
          createdBy: actorId,
        })),
      );
      const insertedLines = await tx.query.purchaseOrderLines.findMany({
        where: eq(purchaseOrderLines.purchaseOrderId, created.id),
      });

      const withTotal = await this.recomputeTotal(tx, created.id);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "purchase_order.created.v1",
        dedupeKey: `purchase_order.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: input.projectId, purchaseOrderId: created.id, number },
      });

      return { ...withTotal, lines: insertedLines };
    });
  }

  async updateHeader(tenantId: string, actorId: string, id: string, input: UpdatePurchaseOrderInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const po = await this.requirePurchaseOrder(tx, id);
      if (po.status !== "draft") throw new PurchaseOrderNotDraftError();
      if (input.supplierId) await this.suppliers.requireSupplier(tx, input.supplierId);

      const [updated] = await tx
        .update(purchaseOrders)
        .set({ ...input, updatedBy: actorId })
        .where(eq(purchaseOrders.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "purchase_order.updated.v1",
        dedupeKey: `purchase_order.updated.v1:${id}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, projectId: po.projectId, purchaseOrderId: id, changedFields: Object.keys(input) },
      });

      return updated!;
    });
  }

  async addLine(tenantId: string, actorId: string, id: string, input: CreatePurchaseOrderLineInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const po = await this.requirePurchaseOrder(tx, id);
      if (po.status !== "draft") throw new PurchaseOrderNotDraftError();

      const costCode = await tx.query.costCodes.findFirst({
        where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, po.projectId)),
      });
      if (!costCode) throw new CostCodeNotOnProjectError();

      const [line] = await tx
        .insert(purchaseOrderLines)
        .values({
          tenantId,
          purchaseOrderId: id,
          description: input.description,
          costCodeId: input.costCodeId,
          inventoryItemId: input.inventoryItemId,
          qtyOrdered: input.qtyOrdered,
          uom: input.uom,
          unitCostAmount: input.unitCostAmount,
          createdBy: actorId,
        })
        .returning();
      const created = line!;

      await this.recomputeTotal(tx, id);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "purchase_order_line.created.v1",
        dedupeKey: `purchase_order_line.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, purchaseOrderId: id, purchaseOrderLineId: created.id },
      });

      return created;
    });
  }

  async updateLine(tenantId: string, actorId: string, id: string, lineId: string, input: UpdatePurchaseOrderLineInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const po = await this.requirePurchaseOrder(tx, id);
      if (po.status !== "draft") throw new PurchaseOrderNotDraftError();
      await this.requireLine(tx, id, lineId);

      if (input.costCodeId) {
        const costCode = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, po.projectId)),
        });
        if (!costCode) throw new CostCodeNotOnProjectError();
      }

      const [updated] = await tx
        .update(purchaseOrderLines)
        .set({ ...input, updatedBy: actorId })
        .where(eq(purchaseOrderLines.id, lineId))
        .returning();

      await this.recomputeTotal(tx, id);

      return updated!;
    });
  }

  async deleteLine(tenantId: string, actorId: string, id: string, lineId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const po = await this.requirePurchaseOrder(tx, id);
      if (po.status !== "draft") throw new PurchaseOrderNotDraftError();
      await this.requireLine(tx, id, lineId);

      await tx
        .update(purchaseOrderLines)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(purchaseOrderLines.id, lineId));

      await this.recomputeTotal(tx, id);
    });
  }

  async requirePurchaseOrder(tx: Database, id: string) {
    const po = await tx.query.purchaseOrders.findFirst({
      where: and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)),
    });
    if (!po) throw new PurchaseOrderNotFoundError();
    return po;
  }

  private async requireLine(tx: Database, purchaseOrderId: string, lineId: string) {
    const line = await tx.query.purchaseOrderLines.findFirst({
      where: and(
        eq(purchaseOrderLines.id, lineId),
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId),
        isNull(purchaseOrderLines.deletedAt),
      ),
    });
    if (!line) throw new PurchaseOrderNotFoundError();
    return line;
  }

  // total_amount is the sum of purchase_order_lines.line_total_amount (a
  // DB-generated column) — same "consistency over cleverness"
  // recompute-on-every-mutation convention as change_orders.cost_impact_amount.
  private async recomputeTotal(tx: Database, purchaseOrderId: string) {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${purchaseOrderLines.lineTotalAmount}), 0)` })
      .from(purchaseOrderLines)
      .where(and(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId), isNull(purchaseOrderLines.deletedAt)));

    const [updated] = await tx
      .update(purchaseOrders)
      .set({ totalAmount: Number(row!.total).toFixed(2) })
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .returning();
    return updated!;
  }
}
