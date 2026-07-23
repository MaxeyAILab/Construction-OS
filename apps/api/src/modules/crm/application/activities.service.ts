import { Inject, Injectable } from "@nestjs/common";
import type { CreateActivityInput } from "@constructionos/schemas";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { activities } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";

// database.md §8: polymorphic timeline (entity_type/entity_id). Only the
// opportunity-scoped endpoint is wired this pass (api.md §4's
// `/crm/opportunities/{id}/activities`) — entityType is always
// 'opportunity' here; other entity types are later cross-module reuse,
// not invented ahead of a wired endpoint.
@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async listForOpportunity(tenantId: string, opportunityId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.activities.findMany({
        where: and(eq(activities.entityType, "opportunity"), eq(activities.entityId, opportunityId)),
        orderBy: [desc(activities.occurredAt)],
      }),
    );
  }

  async createForOpportunity(tenantId: string, actorId: string, opportunityId: string, input: CreateActivityInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(activities)
        .values({
          tenantId,
          entityType: "opportunity",
          entityId: opportunityId,
          kind: input.kind,
          subject: input.subject,
          body: input.body,
          ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
          createdBy: actorId,
        })
        .returning();
      const activity = created!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "activity.created.v1",
        dedupeKey: `activity.created.v1:${activity.id}`,
        actorId,
        payload: { companyId: tenantId, activityId: activity.id, entityType: "opportunity", entityId: opportunityId },
      });

      return activity;
    });
  }
}
