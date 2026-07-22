import { Inject, Injectable } from "@nestjs/common";
import type { CompleteDocumentVersionInput, InitiateDocumentVersionInput } from "@constructionos/schemas";
import { eq, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { documentVersions, documents } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { FileUploadService } from "../../files";
import { DocumentVersionNotFoundError } from "../domain/errors";
import { DocumentsService } from "./documents.service";

// FR-DOC-2: "current is a single FK — unambiguous by construction."
// document_versions rows are created once (at complete-upload time) and
// never updated — true immutability, per database.md §16. Reuses
// FileUploadService (architecture §13's presigned-upload/virus-scan
// pipeline, exported from the files module's public index.ts) rather than
// reimplementing S3/scanning — this cross-module call doesn't need to
// share a transaction with the document_versions insert (unlike Estimating/
// Change-Orders' budget propagation) because a version can legitimately
// reference a file whose async virus scan hasn't finished yet; downloads
// already gate on file.status === 'clean'.
@Injectable()
export class DocumentVersionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly fileUpload: FileUploadService,
    private readonly documentsService: DocumentsService,
  ) {}

  async initiateVersion(tenantId: string, actorId: string, documentId: string, input: InitiateDocumentVersionInput) {
    await withTenant(this.db, tenantId, (tx) => this.documentsService.requireDocument(tx, documentId));
    return this.fileUpload.initiateUpload(tenantId, actorId, input);
  }

  async completeVersion(tenantId: string, actorId: string, documentId: string, input: CompleteDocumentVersionInput) {
    await this.fileUpload.completeUpload(tenantId, actorId, input.fileId, input.parts);

    return withTenant(this.db, tenantId, async (tx) => {
      const document = await this.documentsService.requireDocument(tx, documentId);

      const [maxVersionRow] = await tx
        .select({ maxVersion: sql<number | null>`max(${documentVersions.versionNo})` })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId));
      const versionNo = (maxVersionRow!.maxVersion ?? 0) + 1;

      const [version] = await tx
        .insert(documentVersions)
        .values({
          tenantId,
          documentId,
          versionNo,
          fileId: input.fileId,
          drawingMeta: input.drawingMeta,
          createdBy: actorId,
        })
        .returning();
      const created = version!;

      await tx.update(documents).set({ currentVersionId: created.id, updatedBy: actorId }).where(eq(documents.id, documentId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "document_version.created.v1",
        dedupeKey: `document_version.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: document.projectId, documentId, documentVersionId: created.id, versionNo },
      });
      await this.outbox.append(tx, {
        tenantId,
        eventType: "document.updated.v1",
        dedupeKey: `document.updated.v1:${documentId}:version-${versionNo}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: document.projectId,
          documentId,
          changedFields: ["currentVersionId"],
        },
      });

      return created;
    });
  }

  // M13 Client Portal v1 (FR-CLIENT-1): reuses DocumentsService.
  // authorizeRead (docs.document.read internal, or a project-level
  // client-portal "view" share) rather than duplicating the check.
  async getDownloadUrl(tenantId: string, actorId: string, documentVersionId: string): Promise<string> {
    const version = await withTenant(this.db, tenantId, async (tx) => {
      const found = await tx.query.documentVersions.findFirst({ where: eq(documentVersions.id, documentVersionId) });
      if (!found) throw new DocumentVersionNotFoundError();
      const document = await this.documentsService.requireDocument(tx, found.documentId);
      return { ...found, projectId: document.projectId };
    });

    await this.documentsService.authorizeRead(tenantId, actorId, version.projectId);
    return this.fileUpload.getDownloadUrl(tenantId, version.fileId);
  }
}
