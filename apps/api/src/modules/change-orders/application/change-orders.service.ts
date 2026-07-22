import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateChangeOrderInput,
  CreateChangeOrderLineInput,
  ListChangeOrdersQuery,
  UpdateChangeOrderInput,
  UpdateChangeOrderLineInput,
} from "@constructionos/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { changeOrderLines, changeOrders, costCodes, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  ChangeOrderLineNotFoundError,
  ChangeOrderNotDraftError,
  ChangeOrderNotFoundError,
  CostCodeNotOnProjectError,
  ProjectNotFoundError,
} from "../domain/errors";

@Injectable()
export class ChangeOrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string, query: ListChangeOrdersQuery) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.changeOrders.findMany({
        where: and(
          eq(changeOrders.projectId, projectId),
          query.status ? eq(changeOrders.status, query.status) : undefined,
        ),
        orderBy: (t, { desc }) => [desc(t.number)],
      }),
    );
  }

  async getById(tenantId: string, changeOrderId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.requireChangeOrder(tx, changeOrderId);
      const lines = await tx.query.changeOrderLines.findMany({
        where: and(eq(changeOrderLines.changeOrderId, changeOrderId), isNull(changeOrderLines.deletedAt)),
      });
      return { ...co, lines };
    });
  }

  // number is auto-assigned (max+1 per project), not client-supplied — see
  // schema.ts's comment on change_orders.number.
  async create(tenantId: string, actorId: string, projectId: string, input: CreateChangeOrderInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      for (const line of input.lines) {
        const costCode = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.id, line.costCodeId), eq(costCodes.projectId, projectId)),
        });
        if (!costCode) throw new CostCodeNotOnProjectError();
      }

      const [maxNumberRow] = await tx
        .select({ maxNumber: sql<number | null>`max(${changeOrders.number})` })
        .from(changeOrders)
        .where(eq(changeOrders.projectId, projectId));
      const number = (maxNumberRow!.maxNumber ?? 0) + 1;

      const costImpactAmount = input.lines
        .reduce((sum, line) => sum + Number(line.costImpactAmount), 0)
        .toFixed(2);

      const [co] = await tx
        .insert(changeOrders)
        .values({
          tenantId,
          projectId,
          number,
          title: input.title,
          reason: input.reason,
          costImpactAmount,
          priceImpactAmount: input.priceImpactAmount,
          scheduleImpactDays: input.scheduleImpactDays,
          createdBy: actorId,
        })
        .returning();
      const created = co!;

      const insertedLines = await tx
        .insert(changeOrderLines)
        .values(
          input.lines.map((line) => ({
            tenantId,
            changeOrderId: created.id,
            costCodeId: line.costCodeId,
            description: line.description,
            costImpactAmount: line.costImpactAmount,
            createdBy: actorId,
          })),
        )
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order.created.v1",
        dedupeKey: `change_order.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, changeOrderId: created.id, number },
      });

      return { ...created, lines: insertedLines };
    });
  }

  async updateHeader(tenantId: string, actorId: string, changeOrderId: string, input: UpdateChangeOrderInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.requireChangeOrder(tx, changeOrderId);
      if (co.status !== "draft") throw new ChangeOrderNotDraftError();

      const [updated] = await tx
        .update(changeOrders)
        .set({ ...input, updatedBy: actorId })
        .where(eq(changeOrders.id, changeOrderId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order.updated.v1",
        dedupeKey: `change_order.updated.v1:${changeOrderId}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, projectId: co.projectId, changeOrderId, changedFields: Object.keys(input) },
      });

      return updated!;
    });
  }

  async addLine(tenantId: string, actorId: string, changeOrderId: string, input: CreateChangeOrderLineInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.requireChangeOrder(tx, changeOrderId);
      if (co.status !== "draft") throw new ChangeOrderNotDraftError();

      const costCode = await tx.query.costCodes.findFirst({
        where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, co.projectId)),
      });
      if (!costCode) throw new CostCodeNotOnProjectError();

      const [line] = await tx
        .insert(changeOrderLines)
        .values({
          tenantId,
          changeOrderId,
          costCodeId: input.costCodeId,
          description: input.description,
          costImpactAmount: input.costImpactAmount,
          createdBy: actorId,
        })
        .returning();
      const created = line!;

      await this.recomputeCostImpact(tx, changeOrderId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order_line.created.v1",
        dedupeKey: `change_order_line.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: co.projectId, changeOrderId, changeOrderLineId: created.id },
      });

      return created;
    });
  }

  async updateLine(
    tenantId: string,
    actorId: string,
    changeOrderId: string,
    lineId: string,
    input: UpdateChangeOrderLineInput,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.requireChangeOrder(tx, changeOrderId);
      if (co.status !== "draft") throw new ChangeOrderNotDraftError();
      await this.requireLine(tx, changeOrderId, lineId);

      if (input.costCodeId) {
        const costCode = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, co.projectId)),
        });
        if (!costCode) throw new CostCodeNotOnProjectError();
      }

      const [updated] = await tx
        .update(changeOrderLines)
        .set({ ...input, updatedBy: actorId })
        .where(eq(changeOrderLines.id, lineId))
        .returning();

      await this.recomputeCostImpact(tx, changeOrderId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order_line.updated.v1",
        dedupeKey: `change_order_line.updated.v1:${lineId}:${updated!.updatedSeq}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: co.projectId,
          changeOrderId,
          changeOrderLineId: lineId,
          changedFields: Object.keys(input),
        },
      });

      return updated!;
    });
  }

  async deleteLine(tenantId: string, actorId: string, changeOrderId: string, lineId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const co = await this.requireChangeOrder(tx, changeOrderId);
      if (co.status !== "draft") throw new ChangeOrderNotDraftError();
      await this.requireLine(tx, changeOrderId, lineId);

      await tx
        .update(changeOrderLines)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(changeOrderLines.id, lineId));

      await this.recomputeCostImpact(tx, changeOrderId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "change_order_line.deleted.v1",
        dedupeKey: `change_order_line.deleted.v1:${lineId}`,
        actorId,
        payload: { companyId: tenantId, projectId: co.projectId, changeOrderId, changeOrderLineId: lineId },
      });
    });
  }

  async requireChangeOrder(tx: Database, changeOrderId: string) {
    const co = await tx.query.changeOrders.findFirst({ where: eq(changeOrders.id, changeOrderId) });
    if (!co) throw new ChangeOrderNotFoundError();
    return co;
  }

  private async requireLine(tx: Database, changeOrderId: string, lineId: string) {
    const line = await tx.query.changeOrderLines.findFirst({
      where: and(
        eq(changeOrderLines.id, lineId),
        eq(changeOrderLines.changeOrderId, changeOrderId),
        isNull(changeOrderLines.deletedAt),
      ),
    });
    if (!line) throw new ChangeOrderLineNotFoundError();
    return line;
  }

  // database.md §11: cost_impact_amount is the sum of change_order_lines —
  // same "consistency over cleverness" recompute-on-every-mutation
  // convention as estimates.subtotal_amount.
  private async recomputeCostImpact(tx: Database, changeOrderId: string): Promise<void> {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${changeOrderLines.costImpactAmount}), 0)` })
      .from(changeOrderLines)
      .where(and(eq(changeOrderLines.changeOrderId, changeOrderId), isNull(changeOrderLines.deletedAt)));

    await tx
      .update(changeOrders)
      .set({ costImpactAmount: Number(row!.total).toFixed(2) })
      .where(eq(changeOrders.id, changeOrderId));
  }
}
