import { Inject, Injectable } from "@nestjs/common";
import type { CreateAnnotationInput } from "@constructionos/schemas";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { annotations, documentVersions } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { DocumentVersionNotFoundError } from "../domain/errors";

// database.md §16 (FR-DOC-3): "Markups on document_versions ... kept
// separate from bytes so versions stay immutable." api.md §8:
// GET/POST /document-versions/{id}/annotations, permission "comment"
// (docs.document.comment — same module.resource.comment convention as
// tasks.task.comment).
@Injectable()
export class AnnotationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, documentVersionId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.annotations.findMany({
        where: eq(annotations.documentVersionId, documentVersionId),
        orderBy: [asc(annotations.createdAt)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, documentVersionId: string, input: CreateAnnotationInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const version = await tx.query.documentVersions.findFirst({ where: eq(documentVersions.id, documentVersionId) });
      if (!version) throw new DocumentVersionNotFoundError();

      const [annotation] = await tx
        .insert(annotations)
        .values({
          tenantId,
          documentVersionId,
          page: input.page ?? 1,
          kind: input.kind,
          geometry: input.geometry,
          createdBy: actorId,
        })
        .returning();
      const created = annotation!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "annotation.created.v1",
        dedupeKey: `annotation.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, documentVersionId, annotationId: created.id },
      });

      return created;
    });
  }
}
