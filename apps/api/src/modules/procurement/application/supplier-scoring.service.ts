import { Inject, Injectable } from "@nestjs/common";
import type { SupplierRating } from "@constructionos/schemas";
import { and, avg, eq, inArray, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { deliveries, purchaseOrderLines, purchaseOrders, suppliers } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { SuppliersService } from "./suppliers.service";

// database.md §12: "rating jsonb (AI-maintained score: on-time %, price
// index, dispute count — FR-PROC-5)." Two of the three fields are
// deterministic math over this module's own tables — never a model
// judgment, same "money/metrics are computed, not generated" split as
// EstimatorAiService's historical-cost lookup:
//
// - on_time_pct: of this supplier's deliveries against a PO that actually
//   got a promised_date, the share that arrived on or before it.
// - price_index: this supplier's own average unit cost per cost code,
//   averaged (across every cost code it has sold) against this *tenant's*
//   own average unit cost for that same code — 1.0 = in line with what
//   this tenant typically pays, >1 = pricier, <1 = cheaper. Deliberately
//   benchmarks within this codebase's own procurement history rather than
//   cost_item_price_history (Estimating's cost book): purchase_order_lines
//   key off cost_code_id, not cost_item_id — there is no real data link
//   between the two today (CostBookService's own comment: "'manual' is
//   the only [price history] source with a real write path today").
//
// - dispute_count is always null. Computing it needs invoices.match_status
//   (Finance module), and Finance already depends on Procurement
//   (InvoicesService imports SuppliersService/PurchaseOrdersService for
//   counterparty validation and 2-/3-way match) — Procurement importing
//   Finance back would be the exact 3-hop cycle Finance's own module
//   comment warns about. Flagged follow-up: either Finance grows its own
//   supplier-scoring pass that layers dispute_count onto this jsonb, or
//   this field stays null. Not silently dropped from the shape.
@Injectable()
export class SupplierScoringService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly suppliersService: SuppliersService,
  ) {}

  async rescore(tenantId: string, actorId: string, supplierId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.suppliersService.requireSupplier(tx, supplierId);

      const onTimePct = await this.computeOnTimePct(tx, supplierId);
      const priceIndex = await this.computePriceIndex(tx, supplierId);

      const rating: SupplierRating = {
        onTimePct,
        priceIndex,
        disputeCount: null,
        scoredAt: new Date().toISOString(),
      };

      const [updated] = await tx
        .update(suppliers)
        .set({ rating, updatedBy: actorId })
        .where(eq(suppliers.id, supplierId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "supplier.rated.v1",
        dedupeKey: `supplier.rated.v1:${supplierId}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, supplierId },
      });

      return updated!;
    });
  }

  private async computeOnTimePct(tx: Database, supplierId: string): Promise<number | null> {
    const rows = await tx
      .select({ deliveryDate: deliveries.deliveryDate, promisedDate: purchaseOrders.promisedDate })
      .from(deliveries)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, deliveries.purchaseOrderId))
      .where(and(eq(purchaseOrders.supplierId, supplierId), isNull(deliveries.deletedAt)));

    const withPromise = rows.filter((r) => r.promisedDate !== null);
    if (withPromise.length === 0) return null;

    const onTime = withPromise.filter((r) => r.deliveryDate <= r.promisedDate!).length;
    return Math.round((onTime / withPromise.length) * 10000) / 100;
  }

  private async computePriceIndex(tx: Database, supplierId: string): Promise<number | null> {
    const supplierLines = await tx
      .select({ costCodeId: purchaseOrderLines.costCodeId, unitCostAmount: purchaseOrderLines.unitCostAmount })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
      .where(and(eq(purchaseOrders.supplierId, supplierId), isNull(purchaseOrderLines.deletedAt)));
    if (supplierLines.length === 0) return null;

    const supplierPricesByCode = new Map<string, number[]>();
    for (const line of supplierLines) {
      const arr = supplierPricesByCode.get(line.costCodeId) ?? [];
      arr.push(Number(line.unitCostAmount));
      supplierPricesByCode.set(line.costCodeId, arr);
    }

    const costCodeIds = [...supplierPricesByCode.keys()];
    const tenantAvgRows = await tx
      .select({ costCodeId: purchaseOrderLines.costCodeId, tenantAvg: avg(purchaseOrderLines.unitCostAmount) })
      .from(purchaseOrderLines)
      .where(and(inArray(purchaseOrderLines.costCodeId, costCodeIds), isNull(purchaseOrderLines.deletedAt)))
      .groupBy(purchaseOrderLines.costCodeId);
    const tenantAvgByCode = new Map(tenantAvgRows.map((r) => [r.costCodeId, Number(r.tenantAvg)]));

    const ratios: number[] = [];
    for (const [costCodeId, prices] of supplierPricesByCode) {
      const tenantAvg = tenantAvgByCode.get(costCodeId);
      if (!tenantAvg) continue;
      const supplierAvg = prices.reduce((a, b) => a + b, 0) / prices.length;
      ratios.push(supplierAvg / tenantAvg);
    }
    if (ratios.length === 0) return null;

    return Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 1000;
  }
}
