import { Inject, Injectable } from "@nestjs/common";
import type {
  AddAssemblyToEstimateInput,
  BatchCreateEstimateLinesInput,
  CreateEstimateLineInput,
  UpdateEstimateLineInput,
} from "@constructionos/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { assemblies, assemblyItems, costItems, estimateLines, estimates } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { AssemblyNotFoundError, EstimateLineNotFoundError, EstimateNotFoundError } from "../domain/errors";
import { EstimateService } from "./estimate.service";

@Injectable()
export class EstimateLinesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly estimateService: EstimateService,
  ) {}

  async addLine(tenantId: string, actorId: string, estimateId: string, input: CreateEstimateLineInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const estimate = await this.requireEstimate(tx, estimateId);

      const sortOrder = input.sortOrder ?? (await this.nextSortOrder(tx, estimateId));
      const [line] = await tx
        .insert(estimateLines)
        .values({
          tenantId,
          estimateId,
          costCodeRef: input.costCodeRef,
          description: input.description,
          qty: input.qty,
          uom: input.uom,
          unitCostAmount: input.unitCostAmount,
          unitPriceAmount: input.unitPriceAmount,
          assemblyId: input.assemblyId,
          sortOrder,
          source: "manual",
          createdBy: actorId,
        })
        .returning();
      const created = line!;

      await this.estimateService.recomputeTotals(tx, estimateId);
      await this.emitLineCreated(tx, tenantId, actorId, estimate.projectId!, estimateId, created.id);

      return created;
    });
  }

  // api.md §5: "POST /lines:batch (<=500/req)". Each line still gets its
  // own estimate_line.created.v1 (architecture.md §8: every domain change
  // is an event) — unlike the bulk cost-code seeding from a project
  // template, there's no enclosing "estimate created" event to lean on here
  // since the estimate already exists.
  async batchAddLines(tenantId: string, actorId: string, estimateId: string, input: BatchCreateEstimateLinesInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const estimate = await this.requireEstimate(tx, estimateId);

      let sortOrder = await this.nextSortOrder(tx, estimateId);
      const created: (typeof estimateLines.$inferSelect)[] = [];
      for (const lineInput of input.lines) {
        const [line] = await tx
          .insert(estimateLines)
          .values({
            tenantId,
            estimateId,
            costCodeRef: lineInput.costCodeRef,
            description: lineInput.description,
            qty: lineInput.qty,
            uom: lineInput.uom,
            unitCostAmount: lineInput.unitCostAmount,
            unitPriceAmount: lineInput.unitPriceAmount,
            assemblyId: lineInput.assemblyId,
            sortOrder: lineInput.sortOrder ?? sortOrder,
            source: "manual",
            createdBy: actorId,
          })
          .returning();
        created.push(line!);
        sortOrder += 1;
      }

      await this.estimateService.recomputeTotals(tx, estimateId);
      for (const line of created) {
        await this.emitLineCreated(tx, tenantId, actorId, estimate.projectId!, estimateId, line.id);
      }

      return created;
    });
  }

  // Explodes an assembly's items into priced lines at the requested
  // quantity (e.g. "50 SF of this wall assembly") — qty per line is the
  // assembly item's qty_per_unit scaled by the requested quantity;
  // description/uom/unit_cost_amount are copied from the referenced cost
  // item at explosion time (a later cost_item price change doesn't retro-
  // actively reprice already-exploded lines, same as a manual line).
  async addAssemblyToEstimate(
    tenantId: string,
    actorId: string,
    estimateId: string,
    input: AddAssemblyToEstimateInput,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const estimate = await this.requireEstimate(tx, estimateId);

      const assembly = await tx.query.assemblies.findFirst({ where: eq(assemblies.id, input.assemblyId) });
      if (!assembly) throw new AssemblyNotFoundError();

      const items = await tx.query.assemblyItems.findMany({
        where: eq(assemblyItems.assemblyId, assembly.id),
      });

      let sortOrder = await this.nextSortOrder(tx, estimateId);
      const created: (typeof estimateLines.$inferSelect)[] = [];
      for (const item of items) {
        const costItem = await tx.query.costItems.findFirst({ where: eq(costItems.id, item.costItemId) });
        if (!costItem) continue;

        const qty = (Number(item.qtyPerUnit) * Number(input.qty)).toFixed(3);
        const [line] = await tx
          .insert(estimateLines)
          .values({
            tenantId,
            estimateId,
            costCodeRef: input.costCodeRef,
            description: costItem.description,
            qty,
            uom: costItem.uom,
            unitCostAmount: costItem.currentUnitCostAmount,
            assemblyId: assembly.id,
            sortOrder,
            source: "assembly",
            createdBy: actorId,
          })
          .returning();
        created.push(line!);
        sortOrder += 1;
      }

      await this.estimateService.recomputeTotals(tx, estimateId);
      for (const line of created) {
        await this.emitLineCreated(tx, tenantId, actorId, estimate.projectId!, estimateId, line.id);
      }

      return created;
    });
  }

  async updateLine(
    tenantId: string,
    actorId: string,
    estimateId: string,
    lineId: string,
    input: UpdateEstimateLineInput,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const estimate = await this.requireEstimate(tx, estimateId);
      await this.requireLine(tx, estimateId, lineId);

      const [updated] = await tx
        .update(estimateLines)
        .set({ ...input, updatedBy: actorId })
        .where(eq(estimateLines.id, lineId))
        .returning();

      await this.estimateService.recomputeTotals(tx, estimateId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "estimate_line.updated.v1",
        dedupeKey: `estimate_line.updated.v1:${lineId}:${updated!.updatedSeq}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: estimate.projectId!,
          estimateId,
          estimateLineId: lineId,
          changedFields: Object.keys(input),
        },
      });

      return updated!;
    });
  }

  async deleteLine(tenantId: string, actorId: string, estimateId: string, lineId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const estimate = await this.requireEstimate(tx, estimateId);
      await this.requireLine(tx, estimateId, lineId);

      await tx
        .update(estimateLines)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(estimateLines.id, lineId));

      await this.estimateService.recomputeTotals(tx, estimateId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "estimate_line.deleted.v1",
        dedupeKey: `estimate_line.deleted.v1:${lineId}`,
        actorId,
        payload: { companyId: tenantId, projectId: estimate.projectId!, estimateId, estimateLineId: lineId },
      });
    });
  }

  private async requireEstimate(tx: Database, estimateId: string) {
    const estimate = await tx.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
    if (!estimate) throw new EstimateNotFoundError();
    return estimate;
  }

  private async requireLine(tx: Database, estimateId: string, lineId: string) {
    const line = await tx.query.estimateLines.findFirst({
      where: and(eq(estimateLines.id, lineId), eq(estimateLines.estimateId, estimateId), isNull(estimateLines.deletedAt)),
    });
    if (!line) throw new EstimateLineNotFoundError();
    return line;
  }

  private async nextSortOrder(tx: Database, estimateId: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${estimateLines.sortOrder})` })
      .from(estimateLines)
      .where(eq(estimateLines.estimateId, estimateId));
    return (row!.max ?? -1) + 1;
  }

  private async emitLineCreated(
    tx: Database,
    tenantId: string,
    actorId: string,
    projectId: string,
    estimateId: string,
    estimateLineId: string,
  ) {
    await this.outbox.append(tx, {
      tenantId,
      eventType: "estimate_line.created.v1",
      dedupeKey: `estimate_line.created.v1:${estimateLineId}`,
      actorId,
      payload: { companyId: tenantId, projectId, estimateId, estimateLineId },
    });
  }
}
