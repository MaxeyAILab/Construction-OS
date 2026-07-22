import { Inject, Injectable } from "@nestjs/common";
import type { CreateCommentInput } from "@constructionos/schemas";
import { and, asc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { comments } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";

// database.md §17: "Internal polymorphic comment stream (tasks, RFIs,
// POs…): entity_type/id, body, mentions uuid[] (drives notifications)."
// entity_type/entity_id are supplied by the calling module (e.g. Tasks'
// POST /tasks/{id}/comments passes ("task", taskId)) — this service has
// no opinion on what entity types exist.
@Injectable()
export class CommentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, entityType: string, entityId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.comments.findMany({
        where: and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)),
        orderBy: [asc(comments.createdAt)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, entityType: string, entityId: string, input: CreateCommentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [comment] = await tx
        .insert(comments)
        .values({
          tenantId,
          entityType,
          entityId,
          body: input.body,
          mentions: input.mentions ?? [],
          createdBy: actorId,
        })
        .returning();
      const created = comment!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "comment.created.v1",
        dedupeKey: `comment.created.v1:${created.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          entityType,
          entityId,
          commentId: created.id,
          mentions: created.mentions,
        },
      });

      return created;
    });
  }
}
