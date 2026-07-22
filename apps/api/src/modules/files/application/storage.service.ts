import { Inject, Injectable } from "@nestjs/common";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3_BUCKET, S3_CLIENT } from "../infrastructure/s3-client";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export interface MultipartUploadPart {
  partNumber: number;
  url: string;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/**
 * Thin wrapper over the S3-compatible object store (architecture.md §13).
 * The API never proxies file bytes — every method here either returns a
 * presigned URL for the client to use directly, or reads/writes bytes for
 * the post-upload processing worker (scan/thumbnail), never for a request
 * handler in the hot path.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(S3_BUCKET) private readonly bucket: string,
  ) {}

  // architecture.md §13's per-tenant key layout. Object keys are immutable
  // once created — a new upload gets a new file id and therefore a new key,
  // never an overwrite of an existing one.
  objectKey(tenantId: string, fileId: string, filename: string): string {
    const safeName = filename.replace(/[^\w.-]+/g, "_").slice(-200);
    return `tenant/${tenantId}/uploads/${fileId}/${safeName}`;
  }

  thumbnailKey(tenantId: string, fileId: string): string {
    return `tenant/${tenantId}/uploads/${fileId}/thumbnail.webp`;
  }

  async createSinglePutUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
    partCount: number,
  ): Promise<{ uploadId: string; parts: MultipartUploadPart[] }> {
    const { UploadId } = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!UploadId) throw new Error("S3 did not return an upload id for CreateMultipartUpload");

    const parts: MultipartUploadPart[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId,
        PartNumber: partNumber,
      });
      const url = await getSignedUrl(this.s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
      parts.push({ partNumber, url });
    }
    return { uploadId: UploadId, parts };
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  async headObject(key: string): Promise<{ sizeBytes: number; etag: string | undefined }> {
    const result = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { sizeBytes: result.ContentLength ?? 0, etag: result.ETag };
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`empty response body for object ${key}`);
    return Buffer.from(bytes);
  }

  async putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async createDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  }
}
