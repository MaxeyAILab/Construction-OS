import { Inject, Injectable } from "@nestjs/common";
import type { CreateAssemblyInput, CreateCostItemInput, RecordPriceObservationInput } from "@constructionos/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { assemblies, assemblyItems, costItemPriceHistory, costItems } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  AssemblyNotFoundError,
  CostItemNotFoundError,
  DuplicateAssemblyCodeError,
  DuplicateCostItemCodeError,
} from "../domain/errors";

@Injectable()
export class CostBookService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async listCostItems(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.costItems.findMany({ orderBy: (t, { asc }) => [asc(t.code)] }),
    );
  }

  async createCostItem(tenantId: string, actorId: string, input: CreateCostItemInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.costItems.findFirst({
        where: and(eq(costItems.tenantId, tenantId), eq(costItems.code, input.code)),
      });
      if (existing) throw new DuplicateCostItemCodeError();

      const [item] = await tx
        .insert(costItems)
        .values({
          tenantId,
          code: input.code,
          description: input.description,
          uom: input.uom,
          currentUnitCostAmount: input.currentUnitCostAmount,
          laborHoursPerUnit: input.laborHoursPerUnit,
          createdBy: actorId,
        })
        .returning();
      const created = item!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "cost_item.created.v1",
        dedupeKey: `cost_item.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, costItemId: created.id, code: created.code },
      });

      return created;
    });
  }

  async listPriceHistory(tenantId: string, costItemId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const item = await tx.query.costItems.findFirst({ where: eq(costItems.id, costItemId) });
      if (!item) throw new CostItemNotFoundError();

      return tx.query.costItemPriceHistory.findMany({
        where: eq(costItemPriceHistory.costItemId, costItemId),
        orderBy: (t, { desc }) => [desc(t.observedAt)],
      });
    });
  }

  // Gap-fill: api.md §5 only documents GET .../price-history (the ledger
  // feed) — same reasoning as the Budget module's POST .../cost-transactions
  // gap-fill. 'manual' is the only source with a real write path today
  // (see cost_item_price_history's schema comment), so source is hardcoded
  // here rather than accepted from the client.
  async recordPriceObservation(
    tenantId: string,
    actorId: string,
    costItemId: string,
    input: RecordPriceObservationInput,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const item = await tx.query.costItems.findFirst({ where: eq(costItems.id, costItemId) });
      if (!item) throw new CostItemNotFoundError();

      const [observation] = await tx
        .insert(costItemPriceHistory)
        .values({
          tenantId,
          costItemId,
          source: "manual",
          unitCostAmount: input.unitCostAmount,
          createdBy: actorId,
        })
        .returning();

      await tx
        .update(costItems)
        .set({ currentUnitCostAmount: input.unitCostAmount, updatedBy: actorId })
        .where(eq(costItems.id, costItemId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "cost_item.price_observed.v1",
        dedupeKey: `cost_item.price_observed.v1:${observation!.id}`,
        actorId,
        payload: { companyId: tenantId, costItemId, unitCostAmount: input.unitCostAmount, source: "manual" },
      });

      return observation!;
    });
  }

  async listAssemblies(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.assemblies.findMany({ orderBy: (t, { asc }) => [asc(t.code)] }),
    );
  }

  async getAssembly(tenantId: string, assemblyId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const assembly = await tx.query.assemblies.findFirst({ where: eq(assemblies.id, assemblyId) });
      if (!assembly) throw new AssemblyNotFoundError();

      const items = await tx.query.assemblyItems.findMany({
        where: eq(assemblyItems.assemblyId, assembly.id),
      });
      return { ...assembly, items };
    });
  }

  async createAssembly(tenantId: string, actorId: string, input: CreateAssemblyInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.assemblies.findFirst({
        where: and(eq(assemblies.tenantId, tenantId), eq(assemblies.code, input.code)),
      });
      if (existing) throw new DuplicateAssemblyCodeError();

      const costItemIds = input.items.map((item) => item.costItemId);
      const foundItems = await tx.query.costItems.findMany({
        where: inArray(costItems.id, costItemIds),
      });
      if (foundItems.length !== new Set(costItemIds).size) throw new CostItemNotFoundError();

      const [assembly] = await tx
        .insert(assemblies)
        .values({
          tenantId,
          code: input.code,
          name: input.name,
          description: input.description,
          uom: input.uom,
          createdBy: actorId,
        })
        .returning();
      const created = assembly!;

      const items = await tx
        .insert(assemblyItems)
        .values(
          input.items.map((item) => ({
            tenantId,
            assemblyId: created.id,
            costItemId: item.costItemId,
            qtyPerUnit: item.qtyPerUnit,
            createdBy: actorId,
          })),
        )
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "assembly.created.v1",
        dedupeKey: `assembly.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, assemblyId: created.id, code: created.code },
      });

      return { ...created, items };
    });
  }
}
