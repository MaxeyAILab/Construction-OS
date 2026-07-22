import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { files } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events/application/outbox.service";
import { type CompletedPart, StorageService } from "./storage.service";
import { FileProcessingQueue } from "./file-processing.queue";

// S3 multipart parts must be >=5MB (except the last); 8MB keeps every part
// safely above that floor while staying small enough to retry individually
// on a weak connection (arch §13: "resumable for field photos on weak
// signal" — a failed 8MB part is cheap to re-request vs. re-uploading the
// whole file).
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;

export interface InitiateUploadInput {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export type InitiateUploadResult =
  | { fileId: string; uploadMode: "single"; uploadUrl: string }
  | {
      fileId: string;
      uploadMode: "multipart";
      uploadId: string;
      parts: { partNumber: number; url: string }[];
    };

@Injectable()
export class FileUploadService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
    private readonly processingQueue: FileProcessingQueue,
  ) {}

  async initiateUpload(
    tenantId: string,
    actorId: string,
    input: InitiateUploadInput,
  ): Promise<InitiateUploadResult> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          tenantId,
          objectKey: "", // filled in below once we have the generated file id
          originalFilename: input.filename,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          status: "pending",
          createdBy: actorId,
        })
        .returning();
      const file = row!;

      const key = this.storage.objectKey(tenantId, file.id, input.filename);

      if (input.sizeBytes < MULTIPART_THRESHOLD_BYTES) {
        const uploadUrl = await this.storage.createSinglePutUrl(key, input.contentType);
        await tx.update(files).set({ objectKey: key }).where(eq(files.id, file.id));
        return { fileId: file.id, uploadMode: "single", uploadUrl };
      }

      const partCount = Math.ceil(input.sizeBytes / MULTIPART_PART_SIZE_BYTES);
      const { uploadId, parts } = await this.storage.createMultipartUpload(
        key,
        input.contentType,
        partCount,
      );
      await tx
        .update(files)
        .set({ objectKey: key, multipartUploadId: uploadId })
        .where(eq(files.id, file.id));
      return { fileId: file.id, uploadMode: "multipart", uploadId, parts };
    });
  }

  async completeUpload(
    tenantId: string,
    actorId: string,
    fileId: string,
    parts?: CompletedPart[],
  ): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const file = await tx.query.files.findFirst({ where: eq(files.id, fileId) });
      if (!file) throw new NotFoundException("file not found");

      if (file.multipartUploadId) {
        if (!parts?.length) {
          throw new Error("completeUpload requires parts for a multipart upload");
        }
        await this.storage.completeMultipartUpload(file.objectKey, file.multipartUploadId, parts);
      }

      const { sizeBytes } = await this.storage.headObject(file.objectKey);

      await tx
        .update(files)
        .set({ status: "uploaded", multipartUploadId: null, sizeBytes })
        .where(eq(files.id, fileId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "file.uploaded.v1",
        dedupeKey: `file.uploaded.v1:${fileId}`,
        actorId,
        payload: {
          companyId: tenantId,
          fileId,
          objectKey: file.objectKey,
          originalFilename: file.originalFilename,
          contentType: file.contentType,
          sizeBytes,
        },
      });
    });

    await this.processingQueue.enqueue({ fileId, tenantId });
  }

  async getFile(tenantId: string, fileId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const file = await tx.query.files.findFirst({ where: eq(files.id, fileId) });
      if (!file) throw new NotFoundException("file not found");
      return file;
    });
  }

  async getDownloadUrl(tenantId: string, fileId: string): Promise<string> {
    const file = await this.getFile(tenantId, fileId);
    if (file.status !== "clean") {
      throw new Error(`file ${fileId} is not downloadable (status: ${file.status})`);
    }
    return this.storage.createDownloadUrl(file.objectKey);
  }

  // M18 Imports (FR-PLAT-7): a guided import needs to parse the bytes of an
  // already-uploaded, already-scanned CSV server-side (not hand the caller
  // a presigned URL, since the parsing happens inside the API/worker, not
  // in a browser) — same "clean" gate as getDownloadUrl, just returning
  // bytes instead of a URL.
  async getFileBuffer(tenantId: string, fileId: string): Promise<Buffer> {
    const file = await this.getFile(tenantId, fileId);
    if (file.status !== "clean") {
      throw new Error(`file ${fileId} is not readable (status: ${file.status})`);
    }
    return this.storage.getObjectBuffer(file.objectKey);
  }

  // M18 Exports (FR-PLAT-7): an export artifact is generated by the server
  // itself (a CSV built from a DB query), not supplied by a user — it skips
  // the presigned-upload/virus-scan pipeline entirely and is inserted
  // already `clean`, same reasoning a password-reset flow skips MFA: there's
  // no untrusted external input here to scan.
  async storeGeneratedFile(
    tenantId: string,
    actorId: string,
    input: { filename: string; contentType: string; buffer: Buffer },
  ): Promise<{ fileId: string }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          tenantId,
          objectKey: "",
          originalFilename: input.filename,
          contentType: input.contentType,
          sizeBytes: input.buffer.byteLength,
          status: "clean",
          createdBy: actorId,
        })
        .returning();
      const file = row!;

      const key = this.storage.objectKey(tenantId, file.id, input.filename);
      await this.storage.putObjectBuffer(key, input.buffer, input.contentType);
      await tx.update(files).set({ objectKey: key }).where(eq(files.id, file.id));

      return { fileId: file.id };
    });
  }
}
