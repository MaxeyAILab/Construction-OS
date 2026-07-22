import { Inject, Injectable } from "@nestjs/common";
import type { CreateDocumentInput, ListDocumentsQuery, UpdateDocumentInput } from "@constructionos/schemas";
import { and, desc, eq, ilike, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { documents, documentVersions, folders, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ExternalSharesService, PermissionResolverService } from "../../rbac";
import { DocumentNotFoundError, DocumentReadDeniedError, FolderNotFoundError, ProjectNotFoundError } from "../domain/errors";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly permissions: PermissionResolverService,
    private readonly externalShares: ExternalSharesService,
  ) {}

  // api.md §8: "Tree + metadata; ?q= name search".
  //
  // M13 Client Portal v1 (FR-CLIENT-1): docs.document.read (internal) or a
  // project-level client-portal "view" share — same dual-path pattern as
  // Change Orders' approve() and Scheduling's getActiveSchedule().
  async list(tenantId: string, actorId: string, projectId: string, query: ListDocumentsQuery) {
    await this.authorizeRead(tenantId, actorId, projectId);
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [eq(documents.projectId, projectId), isNull(documents.deletedAt)];
      if (query.folderId) conditions.push(eq(documents.folderId, query.folderId));
      if (query.q) conditions.push(ilike(documents.name, `%${query.q}%`));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(lt(documents.createdAt, new Date(c.createdAt)), and(eq(documents.createdAt, new Date(c.createdAt)), lt(documents.id, c.id))!)!,
        );
      }

      const rows = await tx.query.documents.findMany({
        where: and(...conditions),
        orderBy: [desc(documents.createdAt), desc(documents.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, actorId: string, documentId: string) {
    const projectId = await withTenant(this.db, tenantId, async (tx) => {
      const document = await this.requireDocument(tx, documentId);
      return document.projectId;
    });
    await this.authorizeRead(tenantId, actorId, projectId);

    return withTenant(this.db, tenantId, async (tx) => {
      const document = await this.requireDocument(tx, documentId);
      const versions = await tx.query.documentVersions.findMany({
        where: eq(documentVersions.documentId, documentId),
        orderBy: (t, { desc: d }) => [d(t.versionNo)],
      });
      return { ...document, versions };
    });
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateDocumentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      if (input.folderId) {
        const folder = await tx.query.folders.findFirst({
          where: and(eq(folders.id, input.folderId), eq(folders.projectId, projectId)),
        });
        if (!folder) throw new FolderNotFoundError();
      }

      const [document] = await tx
        .insert(documents)
        .values({
          tenantId,
          projectId,
          folderId: input.folderId,
          name: input.name,
          category: input.category,
          createdBy: actorId,
        })
        .returning();
      const created = document!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "document.created.v1",
        dedupeKey: `document.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, documentId: created.id, name: created.name, category: created.category },
      });

      return created;
    });
  }

  // Gap-fill: api.md §8's table only itemizes GET/POST, but "update" is
  // named as the permission verb for the versions endpoints, implying a
  // reachable update action on the document itself too (rename/move/
  // recategorize).
  async update(tenantId: string, actorId: string, documentId: string, input: UpdateDocumentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const document = await this.requireDocument(tx, documentId);

      if (input.folderId) {
        const folder = await tx.query.folders.findFirst({
          where: and(eq(folders.id, input.folderId), eq(folders.projectId, document.projectId)),
        });
        if (!folder) throw new FolderNotFoundError();
      }

      const [updated] = await tx
        .update(documents)
        .set({ ...input, updatedBy: actorId })
        .where(eq(documents.id, documentId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "document.updated.v1",
        dedupeKey: `document.updated.v1:${documentId}:${updated!.updatedSeq}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: document.projectId,
          documentId,
          changedFields: Object.keys(input),
        },
      });

      return updated!;
    });
  }

  async requireDocument(tx: Database, documentId: string) {
    const document = await tx.query.documents.findFirst({
      where: and(eq(documents.id, documentId), isNull(documents.deletedAt)),
    });
    if (!document) throw new DocumentNotFoundError();
    return document;
  }

  async authorizeRead(tenantId: string, actorId: string, projectId: string): Promise<void> {
    const hasPermission = await this.permissions.has(tenantId, actorId, "docs.document.read");
    if (hasPermission) return;
    const hasShare = await this.externalShares.hasAccess(tenantId, actorId, "project", projectId, "view");
    if (!hasShare) throw new DocumentReadDeniedError();
  }
}
