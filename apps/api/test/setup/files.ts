import type { S3Client } from "@aws-sdk/client-s3";
import type Redis from "ioredis";
import { createQueueConnection } from "../../src/infrastructure/queue/connection";
import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { FileProcessingQueue } from "../../src/modules/files/application/file-processing.queue";
import { FileProcessingService } from "../../src/modules/files/application/file-processing.service";
import { FileUploadService } from "../../src/modules/files/application/file-upload.service";
import type { CompletedPart } from "../../src/modules/files/application/storage.service";
import { StorageService } from "../../src/modules/files/application/storage.service";
import { ThumbnailService } from "../../src/modules/files/application/thumbnail.service";
import type { VirusScanner, VirusScanResult } from "../../src/modules/files/domain/virus-scanner";

interface StoredObject {
  buffer: Buffer;
  contentType: string;
}

/**
 * A real StorageService whose network-calling methods are overridden with
 * an in-memory object map — every other method (objectKey, thumbnailKey)
 * runs its real implementation. This lets tests exercise the actual
 * FileUploadService/FileProcessingService logic (DB writes, RLS, outbox
 * events, single-vs-multipart branching) without a real S3-compatible
 * endpoint, which isn't available in this environment (no Docker daemon —
 * see infra/observability/README.md for the same constraint elsewhere).
 */
export class FakeStorageService extends StorageService {
  private readonly objects = new Map<string, StoredObject>();
  private readonly multipartParts = new Map<string, Map<number, Buffer>>();

  constructor() {
    super(undefined as unknown as S3Client, "test-bucket");
  }

  override async createSinglePutUrl(key: string): Promise<string> {
    return `fake://upload/${encodeURIComponent(key)}`;
  }

  override async createMultipartUpload(key: string, _contentType: string, partCount: number) {
    const uploadId = `fake-upload-${Math.random().toString(36).slice(2)}`;
    this.multipartParts.set(uploadId, new Map());
    const parts = Array.from({ length: partCount }, (_, i) => ({
      partNumber: i + 1,
      url: `fake://upload/${encodeURIComponent(key)}?part=${i + 1}&uploadId=${uploadId}`,
    }));
    return { uploadId, parts };
  }

  override async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    const stored = this.multipartParts.get(uploadId);
    if (!stored) throw new Error(`unknown multipart upload ${uploadId}`);
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const buffer = Buffer.concat(ordered.map((p) => stored.get(p.partNumber)!));
    this.objects.set(key, { buffer, contentType: "application/octet-stream" });
    this.multipartParts.delete(uploadId);
  }

  override async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    this.multipartParts.delete(uploadId);
  }

  override async headObject(key: string) {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`no fake object at ${key}`);
    return { sizeBytes: obj.buffer.length, etag: "fake-etag" };
  }

  override async getObjectBuffer(key: string): Promise<Buffer> {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`no fake object at ${key}`);
    return obj.buffer;
  }

  override async putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { buffer: body, contentType });
  }

  override async createDownloadUrl(key: string): Promise<string> {
    return `fake://download/${encodeURIComponent(key)}`;
  }

  // Test-only helpers simulating what a real client does against the
  // presigned URLs above.
  fakeClientUploadSingle(key: string, buffer: Buffer, contentType: string): void {
    this.objects.set(key, { buffer, contentType });
  }

  fakeClientUploadPart(uploadId: string, partNumber: number, buffer: Buffer): void {
    const stored = this.multipartParts.get(uploadId);
    if (!stored) throw new Error(`unknown multipart upload ${uploadId}`);
    stored.set(partNumber, buffer);
  }

  getStoredObject(key: string): StoredObject | undefined {
    return this.objects.get(key);
  }
}

// EICAR is the industry-standard fake-malware string antivirus test suites
// use — real ClamAV flags it as "Eicar-Test-Signature" without containing
// any actual malicious code. Mirroring that convention here rather than
// inventing an arbitrary marker.
export const EICAR_MARKER = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

export class FakeVirusScanner implements VirusScanner {
  async scan(buffer: Buffer): Promise<VirusScanResult> {
    if (buffer.includes(EICAR_MARKER)) {
      return { clean: false, signature: "Eicar-Test-Signature" };
    }
    return { clean: true };
  }
}

export function buildTestFileServices(db: Database): {
  storage: FakeStorageService;
  fileUploadService: FileUploadService;
  fileProcessingService: FileProcessingService;
  queueConnection: Redis;
} {
  const storage = new FakeStorageService();
  const outbox = new OutboxService();
  const queueConnection = createQueueConnection({
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  });
  const processingQueue = new FileProcessingQueue(queueConnection);
  const fileUploadService = new FileUploadService(db, storage, outbox, processingQueue);
  const fileProcessingService = new FileProcessingService(
    db,
    storage,
    new FakeVirusScanner(),
    new ThumbnailService(),
    outbox,
  );

  return { storage, fileUploadService, fileProcessingService, queueConnection };
}
