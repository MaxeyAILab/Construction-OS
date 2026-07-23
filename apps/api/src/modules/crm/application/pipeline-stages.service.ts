import { Inject, Injectable } from "@nestjs/common";
import type { CreatePipelineStageInput, UpdatePipelineStageInput } from "@constructionos/schemas";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { pipelineStages } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { PipelineStageNotFoundError } from "../domain/errors";

// database.md §8: "tenant-configurable ordered stages" (api.md §4:
// crm.settings.manage).
@Injectable()
export class PipelineStagesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.pipelineStages.findMany({
        where: isNull(pipelineStages.deletedAt),
        orderBy: [asc(pipelineStages.displayOrder)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, input: CreatePipelineStageInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(pipelineStages)
        .values({ tenantId, ...input, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "pipeline_stage.created.v1",
        dedupeKey: `pipeline_stage.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, pipelineStageId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdatePipelineStageInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireStage(tx, id);
      const [updated] = await tx
        .update(pipelineStages)
        .set({ ...input, updatedBy: actorId })
        .where(eq(pipelineStages.id, id))
        .returning();
      return updated!;
    });
  }

  private async requireStage(tx: Database, id: string) {
    const row = await tx.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.id, id), isNull(pipelineStages.deletedAt)) });
    if (!row) throw new PipelineStageNotFoundError();
    return row;
  }
}
