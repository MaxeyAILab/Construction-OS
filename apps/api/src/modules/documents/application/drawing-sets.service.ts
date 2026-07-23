import { Inject, Injectable } from "@nestjs/common";
import type { CreateDrawingSetInput } from "@constructionos/schemas";
import { and, eq, ne } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { documentVersions, documents, drawingSetSheets, drawingSets, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { DocumentVersionNotOnProjectError, DrawingSetNotFoundError, ProjectNotFoundError } from "../domain/errors";

// database.md §16: "Named issued sets ... junction to specific
// document_versions; the field working set pins one set (FR-DOC-5 offline
// determinism)."
@Injectable()
export class DrawingSetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.drawingSets.findMany({ where: eq(drawingSets.projectId, projectId) }),
    );
  }

  // roadmap.md "Field tasks/punch + drawing viewer offline". FR-DOC-5's
  // "the field working set pins one set" — null (not an error) when the
  // project has never had a set published, same "not computable yet"
  // treatment sync-working-set.service.ts already gives lookbackDays.
  async getPublished(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const set = await tx.query.drawingSets.findFirst({
        where: and(eq(drawingSets.projectId, projectId), eq(drawingSets.isPublished, true)),
      });
      if (!set) return null;

      const sheets = await tx.query.drawingSetSheets.findMany({
        where: eq(drawingSetSheets.drawingSetId, set.id),
        orderBy: (t, { asc }) => [asc(t.sortOrder)],
      });
      return { ...set, sheets };
    });
  }

  async getById(tenantId: string, drawingSetId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const set = await this.requireDrawingSet(tx, drawingSetId);
      const sheets = await tx.query.drawingSetSheets.findMany({
        where: eq(drawingSetSheets.drawingSetId, drawingSetId),
        orderBy: (t, { asc }) => [asc(t.sortOrder)],
      });
      return { ...set, sheets };
    });
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateDrawingSetInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      for (const sheet of input.sheets) {
        const version = await tx.query.documentVersions.findFirst({
          where: eq(documentVersions.id, sheet.documentVersionId),
        });
        if (!version) throw new DocumentVersionNotOnProjectError();
        const document = await tx.query.documents.findFirst({
          where: and(eq(documents.id, version.documentId), eq(documents.projectId, projectId)),
        });
        if (!document) throw new DocumentVersionNotOnProjectError();
      }

      const [set] = await tx
        .insert(drawingSets)
        .values({ tenantId, projectId, name: input.name, createdBy: actorId })
        .returning();
      const created = set!;

      const sheets = await tx
        .insert(drawingSetSheets)
        .values(
          input.sheets.map((sheet, index) => ({
            tenantId,
            drawingSetId: created.id,
            documentVersionId: sheet.documentVersionId,
            sortOrder: sheet.sortOrder ?? index,
            createdBy: actorId,
          })),
        )
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "drawing_set.created.v1",
        dedupeKey: `drawing_set.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, drawingSetId: created.id, name: created.name },
      });

      return { ...created, sheets };
    });
  }

  // FR-DOC-5: "the field working set pins one set" — un-publishes any
  // other published set for the project in the same transaction, matching
  // the partial-unique-index-per-project constraint the schema enforces.
  async publish(tenantId: string, actorId: string, drawingSetId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const set = await this.requireDrawingSet(tx, drawingSetId);

      await tx
        .update(drawingSets)
        .set({ isPublished: false, updatedBy: actorId })
        .where(
          and(eq(drawingSets.projectId, set.projectId), eq(drawingSets.isPublished, true), ne(drawingSets.id, set.id)),
        );

      const [published] = await tx
        .update(drawingSets)
        .set({ isPublished: true, updatedBy: actorId })
        .where(eq(drawingSets.id, drawingSetId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "drawing_set.published.v1",
        dedupeKey: `drawing_set.published.v1:${drawingSetId}:${published!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, projectId: set.projectId, drawingSetId },
      });

      return published!;
    });
  }

  private async requireDrawingSet(tx: Database, drawingSetId: string) {
    const set = await tx.query.drawingSets.findFirst({ where: eq(drawingSets.id, drawingSetId) });
    if (!set) throw new DrawingSetNotFoundError();
    return set;
  }
}
