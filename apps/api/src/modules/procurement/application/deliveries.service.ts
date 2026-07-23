import { Inject, Injectable } from "@nestjs/common";
import type { CreateDeliveryInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { deliveries, deliveryLines, purchaseOrderLines, purchaseOrders } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  DeliveryLineExceedsOrderedQtyError,
  PurchaseOrderIllegalTransitionError,
  PurchaseOrderNotFoundError,
} from "../domain/errors";

// database.md §12 (M5, FR-PROC-4): "Receipt against PO lines... triggers
// stock_levels update (on-site receipt) and 3-way-match state for
// supplier invoices (FR-VEND-2)." Both are flagged, not built: Inventory
// (M10) is a later roadmap row, and no invoices/AP module exists yet.
// Delivery photos attach via the existing photos.entityType='delivery'
// (already open-ended text, no schema change needed).
const RECEIVABLE_STATUSES = ["approved", "sent", "confirmed", "partially_received"];

@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async listForPurchaseOrder(tenantId: string, purchaseOrderId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.deliveries.findMany({
        where: and(eq(deliveries.purchaseOrderId, purchaseOrderId), isNull(deliveries.deletedAt)),
        orderBy: (t, { desc }) => [desc(t.deliveryDate)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, purchaseOrderId: string, input: CreateDeliveryInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const po = await tx.query.purchaseOrders.findFirst({
        where: and(eq(purchaseOrders.id, purchaseOrderId), isNull(purchaseOrders.deletedAt)),
      });
      if (!po) throw new PurchaseOrderNotFoundError();
      if (!RECEIVABLE_STATUSES.includes(po.status)) throw new PurchaseOrderIllegalTransitionError(RECEIVABLE_STATUSES.join("|"));

      const [delivery] = await tx
        .insert(deliveries)
        .values({
          tenantId,
          purchaseOrderId,
          deliveryDate: input.deliveryDate,
          receivedBy: actorId,
          notes: input.notes,
          createdBy: actorId,
        })
        .returning();
      const created = delivery!;

      for (const line of input.lines) {
        const poLine = await tx.query.purchaseOrderLines.findFirst({
          where: and(
            eq(purchaseOrderLines.id, line.purchaseOrderLineId),
            eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId),
            isNull(purchaseOrderLines.deletedAt),
          ),
        });
        if (!poLine) throw new PurchaseOrderNotFoundError();

        const newQtyReceived = Number(poLine.qtyReceived) + Number(line.qtyReceived);
        if (newQtyReceived > Number(poLine.qtyOrdered)) throw new DeliveryLineExceedsOrderedQtyError();

        await tx
          .insert(deliveryLines)
          .values({
            tenantId,
            deliveryId: created.id,
            purchaseOrderLineId: line.purchaseOrderLineId,
            qtyReceived: line.qtyReceived,
            createdBy: actorId,
          });

        await tx
          .update(purchaseOrderLines)
          .set({ qtyReceived: newQtyReceived.toFixed(3), updatedBy: actorId })
          .where(eq(purchaseOrderLines.id, line.purchaseOrderLineId));
      }

      await this.recomputeReceiptStatus(tx, purchaseOrderId, actorId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "delivery.created.v1",
        dedupeKey: `delivery.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: po.projectId, purchaseOrderId, deliveryId: created.id },
      });

      return created;
    });
  }

  // FR-PROC-1: "track them through delivery." Derives partially_received
  // vs received from actual line quantities rather than accepting a
  // status from the client — same "state derived from facts, not
  // asserted" reasoning as budget_lines' maintained aggregates.
  private async recomputeReceiptStatus(tx: Database, purchaseOrderId: string, actorId: string) {
    const lines = await tx.query.purchaseOrderLines.findMany({
      where: and(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId), isNull(purchaseOrderLines.deletedAt)),
    });

    const fullyReceived = lines.every((line) => Number(line.qtyReceived) >= Number(line.qtyOrdered));
    const anyReceived = lines.some((line) => Number(line.qtyReceived) > 0);
    const newStatus = fullyReceived ? "received" : anyReceived ? "partially_received" : undefined;
    if (!newStatus) return;

    await tx
      .update(purchaseOrders)
      .set({ status: newStatus, updatedBy: actorId })
      .where(eq(purchaseOrders.id, purchaseOrderId));
  }
}
