import { Inject, Injectable } from "@nestjs/common";
import type { CreateCloseoutChecklistItemInput, UpdateCloseoutChecklistItemInput } from "@constructionos/schemas";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { closeoutChecklistItems } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CloseoutChecklistItemNotFoundError } from "../domain/errors";

// spec.md §13.18 (FR-CLOSE-1). No auto-seeding of standard categories on
// project creation this pass — see the schema file's own doc comment.
@Injectable()
export class CloseoutChecklistService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.closeoutChecklistItems.findMany({
        where: and(eq(closeoutChecklistItems.projectId, projectId), isNull(closeoutChecklistItems.deletedAt)),
        orderBy: [asc(closeoutChecklistItems.createdAt)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateCloseoutChecklistItemInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(closeoutChecklistItems)
        .values({
          tenantId,
          projectId,
          category: input.category,
          title: input.title,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "closeout_checklist_item.created.v1",
        dedupeKey: `closeout_checklist_item.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, checklistItemId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateCloseoutChecklistItemInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await this.requireItem(tx, id);

      const [updated] = await tx
        .update(closeoutChecklistItems)
        .set({
          ...input,
          updatedBy: actorId,
          ...(input.status === "complete" || input.status === "not_applicable"
            ? { completedAt: new Date(), completedBy: actorId }
            : {}),
        })
        .where(eq(closeoutChecklistItems.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "closeout_checklist_item.updated.v1",
        dedupeKey: `closeout_checklist_item.updated.v1:${id}:${Date.now()}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: existing.projectId,
          checklistItemId: id,
          changedFields: Object.keys(input),
        },
      });

      return updated!;
    });
  }

  private async requireItem(tx: Database, id: string) {
    const row = await tx.query.closeoutChecklistItems.findFirst({
      where: and(eq(closeoutChecklistItems.id, id), isNull(closeoutChecklistItems.deletedAt)),
    });
    if (!row) throw new CloseoutChecklistItemNotFoundError();
    return row;
  }
}
