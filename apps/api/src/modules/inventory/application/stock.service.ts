import { Inject, Injectable } from "@nestjs/common";
import type { CreateStockMovementInput, ListStockMovementsQuery, StockQuery } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { CostTransactionsService } from "../../budgets";
import { stockLevels, stockMovements } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { InsufficientStockError } from "../domain/errors";
import { InventoryItemsService } from "./inventory-items.service";
import { InventoryLocationsService } from "./inventory-locations.service";

// database.md §12 (M10): "append-only ledger... same ledger/rollup
// pattern as financials" — stock_movements is the source of truth,
// stock_levels a maintained aggregate cache, updated in the same
// transaction as each movement (FR-INV-1/2).
@Injectable()
export class StockService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly items: InventoryItemsService,
    private readonly locations: InventoryLocationsService,
    private readonly costTransactions: CostTransactionsService,
  ) {}

  async getStock(tenantId: string, query: StockQuery) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.stockLevels.findMany({
        where: and(
          query.itemId ? eq(stockLevels.itemId, query.itemId) : undefined,
          query.locationId ? eq(stockLevels.locationId, query.locationId) : undefined,
        ),
      }),
    );
  }

  async listMovements(tenantId: string, query: ListStockMovementsQuery) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.stockMovements.findMany({
        where: query.itemId ? eq(stockMovements.itemId, query.itemId) : undefined,
        orderBy: (t, { desc: descOp }) => [descOp(t.createdAt)],
        limit: query.limit,
      }),
    );
  }

  // api.md §11: "issue/transfer/adjust (kind), validated against stock;
  // issues cost to project (FR-INV-2)." 'transfer' fans out into a
  // transfer_out row at the source and a transfer_in row at the
  // destination — the DB-level kind enum keeps both sides of a transfer
  // individually auditable even though the client posts one call.
  async postMovement(tenantId: string, actorId: string, input: CreateStockMovementInput) {
    let uom = "";
    let pendingIssueCost: { costCodeId: string; amount: string; qty: string } | undefined;

    const created = await withTenant(this.db, tenantId, async (tx) => {
      const item = await this.items.requireItem(tx, input.itemId);
      uom = item.uom;
      const fromLocation = await this.locations.requireLocation(tx, input.fromLocationId);
      const unitCostAmount = input.unitCostAmount ?? item.defaultUnitCostAmount;

      if (input.kind === "adjustment") {
        const created = await this.writeMovement(tx, tenantId, actorId, {
          kind: "adjustment",
          itemId: input.itemId,
          fromLocationId: fromLocation.id,
          qty: input.qty,
          unitCostAmount,
          memo: input.memo,
        });
        await this.adjustStockLevel(tx, tenantId, input.itemId, fromLocation.id, Number(input.qty), true);
        return created;
      }

      // issue/transfer/return all draw down fromLocationId by a positive
      // qty — validated against what's actually on hand there.
      const currentLevel = await tx.query.stockLevels.findFirst({
        where: and(eq(stockLevels.itemId, input.itemId), eq(stockLevels.locationId, fromLocation.id)),
      });
      if (!currentLevel || Number(currentLevel.qtyOnHand) < Number(input.qty)) throw new InsufficientStockError();

      if (input.kind === "transfer") {
        const toLocation = await this.locations.requireLocation(tx, input.toLocationId!);
        const outMovement = await this.writeMovement(tx, tenantId, actorId, {
          kind: "transfer_out",
          itemId: input.itemId,
          fromLocationId: fromLocation.id,
          qty: input.qty,
          unitCostAmount,
          memo: input.memo,
        });
        await this.writeMovement(tx, tenantId, actorId, {
          kind: "transfer_in",
          itemId: input.itemId,
          toLocationId: toLocation.id,
          qty: input.qty,
          unitCostAmount,
          memo: input.memo,
        });
        await this.adjustStockLevel(tx, tenantId, input.itemId, fromLocation.id, -Number(input.qty), false);
        await this.adjustStockLevel(tx, tenantId, input.itemId, toLocation.id, Number(input.qty), true);
        return outMovement;
      }

      // issue / return
      const created = await this.writeMovement(tx, tenantId, actorId, {
        kind: input.kind,
        itemId: input.itemId,
        fromLocationId: fromLocation.id,
        qty: input.qty,
        unitCostAmount,
        projectId: input.projectId,
        costCodeId: input.costCodeId,
        memo: input.memo,
      });
      await this.adjustStockLevel(tx, tenantId, input.itemId, fromLocation.id, -Number(input.qty), false);

      // FR-INV-2: "record ... consumption and value them into job costs."
      // Only 'issue' posts a job cost — a return isn't a job cost, it's
      // the inverse of one (crediting it back would need to net against
      // the original issue's cost_transactions row, out of scope for
      // this pass).
      if (input.kind === "issue" && input.projectId && input.costCodeId) {
        pendingIssueCost = {
          costCodeId: input.costCodeId,
          amount: (Number(input.qty) * Number(unitCostAmount)).toFixed(2),
          qty: input.qty,
        };
      }

      return created;
    });

    // Posted via CostTransactionsService (budgets/index.ts's public
    // surface — cross-module reuse, same "broaden an existing module's
    // public surface" precedent as postFromTimeEntry) in its own
    // transaction — two-phase write relative to the movement's own,
    // already-committed transaction.
    if (pendingIssueCost && input.projectId) {
      await this.costTransactions.postFromInventoryIssue(tenantId, actorId, input.projectId, {
        costCodeId: pendingIssueCost.costCodeId,
        stockMovementId: created.id,
        txnDate: new Date().toISOString().slice(0, 10),
        amount: pendingIssueCost.amount,
        qty: pendingIssueCost.qty,
        uom,
      });
    }

    return created;
  }

  // Internal-only: posted by DeliveriesService (Procurement) when a PO
  // line has an inventory_item_id and the delivery names a location —
  // same "system posts this, not the API caller" reasoning as
  // 'receipt' being excluded from createStockMovementSchema. Its own
  // transaction (two-phase write relative to the delivery's own,
  // already-committed transaction) — same bounded-looseness precedent as
  // CostTransactionsService.postFromTimeEntry.
  async postReceipt(
    tenantId: string,
    actorId: string,
    input: { itemId: string; locationId: string; qty: string; unitCostAmount: string },
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const created = await this.writeMovement(tx, tenantId, actorId, {
        kind: "receipt",
        itemId: input.itemId,
        toLocationId: input.locationId,
        qty: input.qty,
        unitCostAmount: input.unitCostAmount,
      });
      await this.adjustStockLevel(tx, tenantId, input.itemId, input.locationId, Number(input.qty), true);
      return created;
    });
  }

  private async writeMovement(
    tx: Database,
    tenantId: string,
    actorId: string,
    input: {
      kind: "receipt" | "issue" | "transfer_out" | "transfer_in" | "adjustment" | "return";
      itemId: string;
      fromLocationId?: string | undefined;
      toLocationId?: string | undefined;
      qty: string;
      unitCostAmount: string;
      projectId?: string | undefined;
      costCodeId?: string | undefined;
      memo?: string | undefined;
    },
  ) {
    const [created] = await tx
      .insert(stockMovements)
      .values({ tenantId, createdBy: actorId, ...input })
      .returning();

    await this.outbox.append(tx, {
      tenantId,
      eventType: "stock_movement.posted.v1",
      dedupeKey: `stock_movement.posted.v1:${created!.id}`,
      actorId,
      payload: { companyId: tenantId, stockMovementId: created!.id, itemId: input.itemId, kind: input.kind, qty: input.qty },
    });

    return created!;
  }

  // allowNegative=false guards issue/transfer/return draw-downs (already
  // validated against currentLevel before calling); adjustment can carry
  // the level to any qty >= 0 (still never negative on-hand).
  private async adjustStockLevel(
    tx: Database,
    tenantId: string,
    itemId: string,
    locationId: string,
    delta: number,
    allowMissing: boolean,
  ) {
    const existing = await tx.query.stockLevels.findFirst({
      where: and(eq(stockLevels.itemId, itemId), eq(stockLevels.locationId, locationId)),
    });

    if (!existing) {
      if (!allowMissing || delta < 0) throw new InsufficientStockError();
      await tx.insert(stockLevels).values({ tenantId, itemId, locationId, qtyOnHand: delta.toFixed(3) });
      return;
    }

    const newQty = Number(existing.qtyOnHand) + delta;
    if (newQty < 0) throw new InsufficientStockError();
    await tx.update(stockLevels).set({ qtyOnHand: newQty.toFixed(3) }).where(eq(stockLevels.id, existing.id));
  }
}
