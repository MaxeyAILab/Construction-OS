import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestFileServices } from "./setup/files";
import { buildTestPhotosServices } from "./setup/photos";
import { buildTestProjectServices } from "./setup/projects";

// roadmap.md Phase 1C "Photo capture pipeline (offline, EXIF, resumable)"
// (FR-FIELD-3, database.md §15, architecture.md §13/§6).
describe("Photos (M8 Field Operations)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { storage, fileUploadService, fileProcessingService, queueConnection } = buildTestFileServices(db);
  const { photosService } = buildTestPhotosServices(db, fileUploadService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await queueConnection.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `photos-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Photos ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    return { tenantId: signUp.companyId, ownerId, project };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function outboxEventTypes(tenantId: string): Promise<string[]> {
    const rows = await withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }));
    return rows.map((r) => r.eventType);
  }

  // Mirrors documents.spec.ts's uploadVersion helper: initiate -> fake
  // client upload -> complete, driving the real FileUploadService/
  // PhotosService logic against an in-memory storage fake.
  async function capturePhoto(
    tenantId: string,
    actorId: string,
    projectId: string,
    content: Buffer,
    extra: Partial<{ entityType: string; entityId: string; geoLat: number; geoLng: number; heading: number; deviceId: string }> = {},
  ) {
    const initiated = await photosService.initiateUpload(tenantId, actorId, {
      filename: "jobsite.jpg",
      contentType: "image/jpeg",
      sizeBytes: content.length,
    });
    if (initiated.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(tenantId, initiated.fileId);
    storage.fakeClientUploadSingle(file.objectKey, content, "image/jpeg");

    return photosService.completeUpload(tenantId, actorId, {
      fileId: initiated.fileId,
      projectId,
      takenAt: new Date().toISOString(),
      ...extra,
    });
  }

  it("captures a photo attached to an entity, with geo/heading/deviceId, and posts photo.captured.v1", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("capture");
    const taskId = randomUUID();

    const photo = await capturePhoto(tenantId, ownerId, project.id, Buffer.from("fake-jpeg-bytes"), {
      entityType: "task",
      entityId: taskId,
      geoLat: 37.774929,
      geoLng: -122.419416,
      heading: 180,
      deviceId: "device-abc",
    });

    expect(photo.entityType).toBe("task");
    expect(photo.entityId).toBe(taskId);
    expect(photo.geoLat).toBe("37.774929");
    expect(photo.heading).toBe(180);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("photo.captured.v1");
  });

  it("captures a general project photo with no entity attachment", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("general");
    const photo = await capturePhoto(tenantId, ownerId, project.id, Buffer.from("fake-jpeg-bytes"));
    expect(photo.entityType).toBeNull();
    expect(photo.entityId).toBeNull();
  });

  it("lists photos filtered by project and entity, most recent first", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("list");
    const taskId = randomUUID();
    await capturePhoto(tenantId, ownerId, project.id, Buffer.from("a"), { entityType: "task", entityId: taskId });
    await capturePhoto(tenantId, ownerId, project.id, Buffer.from("b"));

    const filtered = await photosService.list(tenantId, { projectId: project.id, entityType: "task", entityId: taskId, limit: 20 });
    expect(filtered.data).toHaveLength(1);

    const all = await photosService.list(tenantId, { projectId: project.id, limit: 20 });
    expect(all.data).toHaveLength(2);
  });

  it("gates the download/thumbnail URL on the file having finished processing", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("download");
    const sharp = (await import("sharp")).default;
    const image = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    const photo = await capturePhoto(tenantId, ownerId, project.id, image);

    await expect(photosService.getDownloadUrl(tenantId, photo.id)).rejects.toThrow(/not downloadable/);

    await fileProcessingService.process({ fileId: photo.fileId, tenantId });
    const url = await photosService.getDownloadUrl(tenantId, photo.id);
    expect(url).toMatch(/^fake:\/\/download\//);

    const thumbUrl = await photosService.getThumbnailUrl(tenantId, photo.id);
    expect(thumbUrl).toMatch(/^fake:\/\/download\//);
  });

  it("RLS: a tenant only sees its own photos", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await capturePhoto(a.tenantId, a.ownerId, a.project.id, Buffer.from("a-only"));

    const bPhotos = await photosService.list(b.tenantId, { limit: 20 });
    expect(bPhotos.data).toHaveLength(0);

    const aPhotos = await photosService.list(a.tenantId, { limit: 20 });
    expect(aPhotos.data.length).toBeGreaterThan(0);
    expect(aPhotos.data.every((p) => p.tenantId === a.tenantId)).toBe(true);
  });
});
