import { Inject, Injectable } from "@nestjs/common";
import type { CreateEquipmentUsageLogInput, ListEquipmentUsageLogsQuery } from "@constructionos/schemas";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { equipmentUsageLogs } from "../../../infrastructure/db/schema";
import { CostTransactionsService } from "../../budgets";
import { OutboxService } from "../../events";
import { EquipmentService } from "./equipment.service";

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

// database.md §13 / FR-EQ-2: "hours/odometer per day ... generates
// cost_transactions at the equipment rate." Only `hours` has a defined
// rate basis (hourly_cost_rate_amount) — odometer is captured for
// maintenance due-state projection (FR-EQ-3), not costing. A job cost
// only posts when the log is tagged to a project + cost code; equipment
// can log general/overhead use with nothing to cost yet (see schema
// comment on equipment_usage_logs).
@Injectable()
export class EquipmentUsageLogsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly equipmentService: EquipmentService,
    private readonly costTransactions: CostTransactionsService,
  ) {}

  async listForEquipment(tenantId: string, equipmentId: string, query: ListEquipmentUsageLogsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [eq(equipmentUsageLogs.equipmentId, equipmentId)];
      if (query.projectId) conditions.push(eq(equipmentUsageLogs.projectId, query.projectId));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(equipmentUsageLogs.createdAt, new Date(c.createdAt)),
            and(eq(equipmentUsageLogs.createdAt, new Date(c.createdAt)), lt(equipmentUsageLogs.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.equipmentUsageLogs.findMany({
        where: and(...conditions),
        orderBy: [desc(equipmentUsageLogs.createdAt), desc(equipmentUsageLogs.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async create(tenantId: string, actorId: string, equipmentId: string, input: CreateEquipmentUsageLogInput) {
    let pendingCost: { projectId: string; costCodeId: string; amount: string; hours: string } | undefined;

    const created = await withTenant(this.db, tenantId, async (tx) => {
      const item = await this.equipmentService.requireEquipment(tx, equipmentId);

      const [row] = await tx
        .insert(equipmentUsageLogs)
        .values({
          tenantId,
          equipmentId,
          projectId: input.projectId,
          costCodeId: input.costCodeId,
          operatorId: input.operatorId,
          workDate: input.workDate,
          hours: input.hours,
          odometer: input.odometer,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "equipment_usage_log.created.v1",
        dedupeKey: `equipment_usage_log.created.v1:${row!.id}`,
        actorId,
        payload: { companyId: tenantId, equipmentId, equipmentUsageLogId: row!.id, projectId: input.projectId },
      });

      if (input.hours && input.projectId && input.costCodeId) {
        pendingCost = {
          projectId: input.projectId,
          costCodeId: input.costCodeId,
          amount: (Number(input.hours) * Number(item.hourlyCostRateAmount)).toFixed(2),
          hours: input.hours,
        };
      }

      return row!;
    });

    if (pendingCost) {
      await this.costTransactions.postFromEquipmentUsage(tenantId, actorId, pendingCost.projectId, {
        costCodeId: pendingCost.costCodeId,
        equipmentUsageLogId: created.id,
        txnDate: input.workDate,
        amount: pendingCost.amount,
        qty: pendingCost.hours,
        uom: "hr",
      });
    }

    return created;
  }
}
