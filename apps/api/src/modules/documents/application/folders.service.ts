import { Inject, Injectable } from "@nestjs/common";
import type { CreateFolderInput, UpdateFolderInput } from "@constructionos/schemas";
import { and, asc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { folders, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { FolderNotFoundError, ProjectNotFoundError } from "../domain/errors";

// database.md §16: "project tree (adjacency list)" — same pattern as
// Projects' cost-codes WBS tree.
@Injectable()
export class FoldersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.folders.findMany({
        where: eq(folders.projectId, projectId),
        orderBy: [asc(folders.parentId), asc(folders.name)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateFolderInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      if (input.parentId) {
        const parent = await tx.query.folders.findFirst({
          where: and(eq(folders.id, input.parentId), eq(folders.projectId, projectId)),
        });
        if (!parent) throw new FolderNotFoundError();
      }

      const [folder] = await tx
        .insert(folders)
        .values({
          tenantId,
          projectId,
          name: input.name,
          parentId: input.parentId,
          createdBy: actorId,
        })
        .returning();
      const created = folder!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "folder.created.v1",
        dedupeKey: `folder.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, folderId: created.id, name: created.name },
      });

      return created;
    });
  }

  // Gap-fill: api.md §8 only itemizes GET/POST for folders — matches
  // CostCodesService.update's precedent of a plain rename/reparent with no
  // dedicated event (no real consumer needs one yet). Flat /folders/{id}
  // route (like document-versions/download) — projectId is derived from
  // the folder itself rather than taken from the path.
  async update(tenantId: string, actorId: string, folderId: string, input: UpdateFolderInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.folders.findFirst({ where: eq(folders.id, folderId) });
      if (!existing) throw new FolderNotFoundError();

      if (input.parentId) {
        const parent = await tx.query.folders.findFirst({
          where: and(eq(folders.id, input.parentId), eq(folders.projectId, existing.projectId)),
        });
        if (!parent) throw new FolderNotFoundError();
      }

      const [updated] = await tx
        .update(folders)
        .set({ ...input, updatedBy: actorId })
        .where(eq(folders.id, folderId))
        .returning();
      return updated!;
    });
  }
}
