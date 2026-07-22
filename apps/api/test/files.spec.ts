import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestFileServices, EICAR_MARKER } from "./setup/files";

describe("File pipeline", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { storage, fileUploadService, fileProcessingService, queueConnection } =
    buildTestFileServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await queueConnection.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return authService.signUp({
      email: `files-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Files ${label} ${suffix}`,
    });
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function outboxEventTypes(tenantId: string): Promise<string[]> {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    );
    return rows.map((r) => r.eventType);
  }

  it("single-PUT path: small file uploads, completes, and processes to clean (no thumbnail for text/plain)", async () => {
    const signUp = await signUpCompany("single");
    const ownerId = decodeSub(signUp.accessToken);
    const content = Buffer.from("hello from a field report\n");

    const result = await fileUploadService.initiateUpload(signUp.companyId, ownerId, {
      filename: "notes.txt",
      contentType: "text/plain",
      sizeBytes: content.length,
    });
    expect(result.uploadMode).toBe("single");
    if (result.uploadMode !== "single") throw new Error("expected single mode");

    const pending = await fileUploadService.getFile(signUp.companyId, result.fileId);
    expect(pending.status).toBe("pending");
    expect(pending.objectKey).toContain(signUp.companyId);

    storage.fakeClientUploadSingle(pending.objectKey, content, "text/plain");
    await fileUploadService.completeUpload(signUp.companyId, ownerId, result.fileId);

    const uploaded = await fileUploadService.getFile(signUp.companyId, result.fileId);
    expect(uploaded.status).toBe("uploaded");
    expect(uploaded.sizeBytes).toBe(content.length);

    await fileProcessingService.process({ fileId: result.fileId, tenantId: signUp.companyId });

    const processed = await fileUploadService.getFile(signUp.companyId, result.fileId);
    expect(processed.status).toBe("clean");
    expect(processed.thumbnailKey).toBeNull();
    expect(processed.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes).toContain("file.uploaded.v1");
    expect(eventTypes).toContain("file.scan_completed.v1");

    const downloadUrl = await fileUploadService.getDownloadUrl(signUp.companyId, result.fileId);
    expect(downloadUrl).toContain("fake://download/");
  });

  it("multipart path: large file splits into parts and completes correctly", async () => {
    const signUp = await signUpCompany("multipart");
    const ownerId = decodeSub(signUp.accessToken);
    const partSize = 8 * 1024 * 1024;
    const totalSize = partSize + 1024; // forces 2 parts

    const result = await fileUploadService.initiateUpload(signUp.companyId, ownerId, {
      filename: "drawing-set.pdf",
      contentType: "application/pdf",
      sizeBytes: totalSize,
    });
    expect(result.uploadMode).toBe("multipart");
    if (result.uploadMode !== "multipart") throw new Error("expected multipart mode");
    expect(result.parts).toHaveLength(2);

    const file = await fileUploadService.getFile(signUp.companyId, result.fileId);
    const part1 = Buffer.alloc(partSize, "a");
    const part2 = Buffer.alloc(1024, "b");
    storage.fakeClientUploadPart(result.uploadId, 1, part1);
    storage.fakeClientUploadPart(result.uploadId, 2, part2);

    await fileUploadService.completeUpload(signUp.companyId, ownerId, result.fileId, [
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
    ]);

    const uploaded = await fileUploadService.getFile(signUp.companyId, result.fileId);
    expect(uploaded.status).toBe("uploaded");
    expect(uploaded.multipartUploadId).toBeNull();
    expect(uploaded.sizeBytes).toBe(totalSize);
    expect(storage.getStoredObject(file.objectKey)?.buffer.length).toBe(totalSize);
  });

  it("virus scan: an infected file is marked infected, gets no thumbnail, and is not downloadable", async () => {
    const signUp = await signUpCompany("infected");
    const ownerId = decodeSub(signUp.accessToken);
    const content = Buffer.from(`X5O!P%@AP[4\\PZX54(P^)7CC)7}$${EICAR_MARKER}!$H+H*`);

    const result = await fileUploadService.initiateUpload(signUp.companyId, ownerId, {
      filename: "invoice.exe",
      contentType: "application/octet-stream",
      sizeBytes: content.length,
    });
    if (result.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(signUp.companyId, result.fileId);
    storage.fakeClientUploadSingle(file.objectKey, content, "application/octet-stream");
    await fileUploadService.completeUpload(signUp.companyId, ownerId, result.fileId);

    await fileProcessingService.process({ fileId: result.fileId, tenantId: signUp.companyId });

    const processed = await fileUploadService.getFile(signUp.companyId, result.fileId);
    expect(processed.status).toBe("infected");
    expect(processed.thumbnailKey).toBeNull();
    expect(processed.scanResult).toMatchObject({ signature: "Eicar-Test-Signature" });

    await expect(fileUploadService.getDownloadUrl(signUp.companyId, result.fileId)).rejects.toThrow(
      /not downloadable/,
    );
  });

  it("thumbnailing: a supported image content-type produces a stored thumbnail", async () => {
    const signUp = await signUpCompany("thumbnail");
    const ownerId = decodeSub(signUp.accessToken);
    const sharp = (await import("sharp")).default;
    const image = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();

    const result = await fileUploadService.initiateUpload(signUp.companyId, ownerId, {
      filename: "site-photo.png",
      contentType: "image/png",
      sizeBytes: image.length,
    });
    if (result.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(signUp.companyId, result.fileId);
    storage.fakeClientUploadSingle(file.objectKey, image, "image/png");
    await fileUploadService.completeUpload(signUp.companyId, ownerId, result.fileId);

    await fileProcessingService.process({ fileId: result.fileId, tenantId: signUp.companyId });

    const processed = await fileUploadService.getFile(signUp.companyId, result.fileId);
    expect(processed.status).toBe("clean");
    expect(processed.thumbnailKey).not.toBeNull();

    const stored = storage.getStoredObject(processed.thumbnailKey!);
    expect(stored).toBeDefined();
    expect(stored!.contentType).toBe("image/webp");
    const meta = await sharp(stored!.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(512);
    expect(meta.height).toBeLessThanOrEqual(512);
  });

  it("RLS: a tenant only sees its own files", async () => {
    const companyA = await signUpCompany("rls-a");
    const companyB = await signUpCompany("rls-b");
    const ownerA = decodeSub(companyA.accessToken);

    await fileUploadService.initiateUpload(companyA.companyId, ownerA, {
      filename: "a.txt",
      contentType: "text/plain",
      sizeBytes: 10,
    });

    const rowsA = await withTenant(db, companyA.companyId, (tx) => tx.query.files.findMany());
    expect(rowsA.every((r) => r.tenantId === companyA.companyId)).toBe(true);

    const rowsB = await withTenant(db, companyB.companyId, (tx) => tx.query.files.findMany());
    expect(rowsB).toHaveLength(0);
    expect(rowsB.some((r) => r.tenantId === companyA.companyId)).toBe(false);
  });

  it("completeUpload without required parts for a multipart upload throws", async () => {
    const signUp = await signUpCompany("missing-parts");
    const ownerId = decodeSub(signUp.accessToken);
    const totalSize = 8 * 1024 * 1024 + 1;

    const result = await fileUploadService.initiateUpload(signUp.companyId, ownerId, {
      filename: "big.bin",
      contentType: "application/octet-stream",
      sizeBytes: totalSize,
    });
    if (result.uploadMode !== "multipart") throw new Error("expected multipart mode");

    await expect(
      fileUploadService.completeUpload(signUp.companyId, ownerId, result.fileId),
    ).rejects.toThrow(/requires parts/);
  });
});
