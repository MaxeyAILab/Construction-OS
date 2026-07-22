import { Inject, Injectable } from "@nestjs/common";
import type { CreateMilestoneInput, UpdateMilestoneInput } from "@constructionos/schemas";
import { and, asc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { milestones } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { MilestoneNotFoundError } from "../domain/errors";

@Injectable()
export class MilestonesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.milestones.findMany({
        where: eq(milestones.projectId, projectId),
        orderBy: [asc(milestones.sortOrder), asc(milestones.dueDate)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateMilestoneInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [milestone] = await tx
        .insert(milestones)
        .values({
          tenantId,
          projectId,
          name: input.name,
          dueDate: input.dueDate,
          sortOrder: input.sortOrder ?? 0,
          createdBy: actorId,
        })
        .returning();
      const created = milestone!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "milestone.created.v1",
        dedupeKey: `milestone.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, milestoneId: created.id, name: created.name },
      });

      return created;
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    projectId: string,
    milestoneId: string,
    input: UpdateMilestoneInput,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.milestones.findFirst({
        where: and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId)),
      });
      if (!existing) throw new MilestoneNotFoundError();

      const { completed, ...rest } = input;
      const [updated] = await tx
        .update(milestones)
        .set({
          ...rest,
          updatedBy: actorId,
          ...(completed !== undefined && { completedAt: completed ? new Date() : null }),
        })
        .where(eq(milestones.id, milestoneId))
        .returning();
      return updated!;
    });
  }
}
