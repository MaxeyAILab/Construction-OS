import { Inject, Injectable } from "@nestjs/common";
import type { CompletePhotoUploadInput, InitiatePhotoUploadInput, ListPhotosQuery } from "@constructionos/schemas";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { photos, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { FileUploadService } from "../../files";
import { PhotoNotFoundError, ProjectNotFoundError } from "../domain/errors";

interface Cursor {
  takenAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// database.md §15 (M8, FR-FIELD-3): "Append-only ... highest-volume
// table." Reuses FileUploadService (architecture §13's presigned-upload/
// virus-scan/resumable-multipart pipeline, already built for Documents)
// rather than reimplementing storage — same "cross-module call doesn't
// need to share a transaction" reasoning as DocumentVersionsService: a
// photo can legitimately reference a file whose async virus scan hasn't
// finished, downloads already gate on file.status === 'clean'.
@Injectable()
export class PhotosService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly fileUpload: FileUploadService,
  ) {}

  async initiateUpload(tenantId: string, actorId: string, input: InitiatePhotoUploadInput) {
    return this.fileUpload.initiateUpload(tenantId, actorId, input);
  }

  async completeUpload(tenantId: string, actorId: string, input: CompletePhotoUploadInput) {
    await this.fileUpload.completeUpload(tenantId, actorId, input.fileId, input.parts);

    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      if (!project) throw new ProjectNotFoundError();

      const [photo] = await tx
        .insert(photos)
        .values({
          tenantId,
          fileId: input.fileId,
          projectId: input.projectId,
          entityType: input.entityType,
          entityId: input.entityId,
          takenAt: new Date(input.takenAt),
          geoLat: input.geoLat?.toString(),
          geoLng: input.geoLng?.toString(),
          heading: input.heading,
          deviceId: input.deviceId,
          createdBy: actorId,
        })
        .returning();
      const created = photo!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "photo.captured.v1",
        dedupeKey: `photo.captured.v1:${created.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: input.projectId,
          photoId: created.id,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        },
      });

      return created;
    });
  }

  async list(tenantId: string, query: ListPhotosQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [];
      if (query.projectId) conditions.push(eq(photos.projectId, query.projectId));
      if (query.entityType) conditions.push(eq(photos.entityType, query.entityType));
      if (query.entityId) conditions.push(eq(photos.entityId, query.entityId));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(lt(photos.takenAt, new Date(c.takenAt)), and(eq(photos.takenAt, new Date(c.takenAt)), lt(photos.id, c.id))!)!,
        );
      }

      const rows = await tx.query.photos.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(photos.takenAt), desc(photos.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ takenAt: last.takenAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const photo = await tx.query.photos.findFirst({ where: eq(photos.id, id) });
      if (!photo) throw new PhotoNotFoundError();
      return photo;
    });
  }

  // M17 Photo AI (ai-spec.md §7.8): file.scan_completed.v1 is file-generic
  // (fires for every uploaded file, not just photos) — its consumer needs
  // to ask "is this scanned file actually a photo, and if so which one"
  // without touching the photos table directly (module boundaries).
  // Returns null rather than throwing: "not a photo" is the expected,
  // common case for most scanned files, not an error.
  async findByFileId(tenantId: string, fileId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.query.photos.findFirst({ where: eq(photos.fileId, fileId) }));
  }

  async getDownloadUrl(tenantId: string, id: string): Promise<string> {
    const photo = await this.getById(tenantId, id);
    return this.fileUpload.getDownloadUrl(tenantId, photo.fileId);
  }

  async getThumbnailUrl(tenantId: string, id: string): Promise<string | null> {
    const photo = await this.getById(tenantId, id);
    return this.fileUpload.getThumbnailUrl(tenantId, photo.fileId);
  }
}
