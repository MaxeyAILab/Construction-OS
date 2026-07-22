import { Inject, Injectable } from "@nestjs/common";
import type { CreateCostCodeInput, UpdateCostCodeInput } from "@constructionos/schemas";
import { and, asc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CostCodeNotFoundError, DuplicateCostCodeError } from "../domain/errors";

// database.md §9: "adjacency-list tree (depth <= 4 in practice); recursive
// CTE reads are cheap at this size; no closure table needed." Returned as
// a flat list ordered by (parent_id, code) rather than nested JSON —
// clients build the tree from parentId, a simpler contract than a
// recursive-CTE-backed nested response for a tree this shallow.
@Injectable()
export class CostCodesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.costCodes.findMany({
        where: eq(costCodes.projectId, projectId),
        orderBy: [asc(costCodes.parentId), asc(costCodes.code)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateCostCodeInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.costCodes.findFirst({
        where: and(eq(costCodes.projectId, projectId), eq(costCodes.code, input.code)),
      });
      if (existing) throw new DuplicateCostCodeError(input.code);

      if (input.parentId) {
        const parent = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.id, input.parentId), eq(costCodes.projectId, projectId)),
        });
        if (!parent) throw new CostCodeNotFoundError();
      }

      const [costCode] = await tx
        .insert(costCodes)
        .values({
          tenantId,
          projectId,
          code: input.code,
          name: input.name,
          division: input.division,
          parentId: input.parentId,
          kind: input.kind,
          createdBy: actorId,
        })
        .returning();
      const created = costCode!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "cost_code.created.v1",
        dedupeKey: `cost_code.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, costCodeId: created.id, code: created.code },
      });

      return created;
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    projectId: string,
    costCodeId: string,
    input: UpdateCostCodeInput,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.costCodes.findFirst({
        where: and(eq(costCodes.id, costCodeId), eq(costCodes.projectId, projectId)),
      });
      if (!existing) throw new CostCodeNotFoundError();

      if (input.code && input.code !== existing.code) {
        const clash = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.projectId, projectId), eq(costCodes.code, input.code)),
        });
        if (clash) throw new DuplicateCostCodeError(input.code);
      }

      const [updated] = await tx
        .update(costCodes)
        .set({ ...input, updatedBy: actorId })
        .where(eq(costCodes.id, costCodeId))
        .returning();
      return updated!;
    });
  }
}
