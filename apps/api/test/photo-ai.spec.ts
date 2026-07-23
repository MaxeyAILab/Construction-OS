import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { auditLog, outbox, photos } from "../src/infrastructure/db/schema";
import { buildTestAuditServices } from "./setup/audit";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestFileServices } from "./setup/files";
import { buildTestPhotoAiServices } from "./setup/photo-ai";
import { buildTestPhotosServices } from "./setup/photos";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRagServices } from "./setup/rag";
import { buildTestRbacServices } from "./setup/rbac";

// ai-spec.md §7.8 (Photo AI, FR-FIELD-7): auto-tagging + defect flagging
// (draft), triggered off file.scan_completed.v1, feeding RAG's
// search-by-content and audit_log's ai_run_id linkage.
describe("Photo AI v1: auto-tagging, defect drafts, search-by-content, audit linkage", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const { storage, fileUploadService, fileProcessingService, queueConnection } = buildTestFileServices(db);
  const { photosService } = buildTestPhotosServices(db, fileUploadService);
  const { photoAiWriterService } = buildTestPhotoAiServices(db, fileUploadService, photosService);
  const { auditWriterService } = buildTestAuditServices(db);
  const { ragIndexingService, ragSearchService, cacheRedis } = buildTestRagServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await rbacRedis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `photo-ai-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Photo AI ${label} ${suffix}`,
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

  // A real (tiny) PNG, not a fake byte string — FileProcessingService's
  // thumbnailing step runs a real sharp decode for any image/* content
  // type, same "generate a real image in-memory" precedent as files.spec.ts's
  // own thumbnailing test.
  async function generatePngBuffer(): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    return sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 200, b: 200 } } })
      .png()
      .toBuffer();
  }

  // Mirrors photos.spec.ts's own helper: initiate -> fake client upload ->
  // complete, driving the real PhotosService/FileUploadService logic.
  async function capturePhoto(tenantId: string, actorId: string, projectId: string) {
    const image = await generatePngBuffer();
    const initiated = await photosService.initiateUpload(tenantId, actorId, {
      filename: "jobsite.png",
      contentType: "image/png",
      sizeBytes: image.length,
    });
    if (initiated.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(tenantId, initiated.fileId);
    storage.fakeClientUploadSingle(file.objectKey, image, "image/png");

    return photosService.completeUpload(tenantId, actorId, {
      fileId: initiated.fileId,
      projectId,
      takenAt: new Date().toISOString(),
    });
  }

  // Same "bypass NATS, replay a real outbox row into the writer directly"
  // approach as dashboards.spec.ts/audit.spec.ts.
  async function replayLatestOutboxEvent(tenantId: string, eventType: string): Promise<OutboxEnvelope> {
    const row = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findFirst({ where: and(eq(outbox.tenantId, tenantId), eq(outbox.eventType, eventType)) }),
    );
    if (!row) throw new Error(`no ${eventType} outbox row found for tenant ${tenantId}`);
    return {
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType,
      payload: row.payload,
      dedupeKey: row.dedupeKey,
      occurredAt: row.occurredAt.toISOString(),
      actorId: row.actorId,
      actorType: row.actorType as OutboxEnvelope["actorType"],
    };
  }

  it("a clean scan of a photo triggers tagging: writes ai_tags and emits photo.tagged.v1", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("clean");
    const photo = await capturePhoto(tenantId, ownerId, project.id);
    await fileProcessingService.process({ fileId: photo.fileId, tenantId });

    const scanEnvelope = await replayLatestOutboxEvent(tenantId, "file.scan_completed.v1");
    await photoAiWriterService.handleEnvelope(scanEnvelope);

    const updated = await withTenant(db, tenantId, (tx) => tx.query.photos.findFirst({ where: eq(photos.id, photo.id) }));
    const aiTags = updated!.aiTags as { tags: unknown[]; defects: unknown[]; model: string };
    expect(aiTags.tags.length).toBeGreaterThan(0);
    expect(aiTags.defects.length).toBeGreaterThan(0);
    expect(aiTags.model).toBe("claude-sonnet-5");

    const taggedRow = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findFirst({ where: and(eq(outbox.tenantId, tenantId), eq(outbox.eventType, "photo.tagged.v1")) }),
    );
    expect(taggedRow).toBeDefined();
    expect((taggedRow!.payload as { photoId: string }).photoId).toBe(photo.id);
  });

  it("an infected scan does not trigger tagging", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("infected");
    const initiated = await photosService.initiateUpload(tenantId, ownerId, {
      filename: "jobsite.jpg",
      contentType: "image/jpeg",
      sizeBytes: 44,
    });
    if (initiated.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(tenantId, initiated.fileId);
    storage.fakeClientUploadSingle(file.objectKey, Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"), "image/jpeg");
    const photo = await photosService.completeUpload(tenantId, ownerId, {
      fileId: initiated.fileId,
      projectId: project.id,
      takenAt: new Date().toISOString(),
    });
    await fileProcessingService.process({ fileId: photo.fileId, tenantId });

    const scanEnvelope = await replayLatestOutboxEvent(tenantId, "file.scan_completed.v1");
    expect((scanEnvelope.payload as { status: string }).status).toBe("infected");
    await photoAiWriterService.handleEnvelope(scanEnvelope);

    const updated = await withTenant(db, tenantId, (tx) => tx.query.photos.findFirst({ where: eq(photos.id, photo.id) }));
    expect(updated!.aiTags).toBeNull();
  });

  it("a scanned file that isn't a photo is a silent no-op", async () => {
    const { tenantId } = await signUpCompanyWithProject("not-a-photo");
    const envelope: OutboxEnvelope = {
      id: randomUUID(),
      tenantId,
      eventType: "file.scan_completed.v1",
      payload: { companyId: tenantId, fileId: randomUUID(), status: "clean" },
      dedupeKey: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorId: null,
      actorType: "system",
    };
    await expect(photoAiWriterService.handleEnvelope(envelope)).resolves.toBeUndefined();
  });

  it("photo.tagged.v1 produces an audit_log row carrying the ai_run_id", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("audit");
    const photo = await capturePhoto(tenantId, ownerId, project.id);
    await fileProcessingService.process({ fileId: photo.fileId, tenantId });
    await photoAiWriterService.handleEnvelope(await replayLatestOutboxEvent(tenantId, "file.scan_completed.v1"));

    const taggedEnvelope = await replayLatestOutboxEvent(tenantId, "photo.tagged.v1");
    await auditWriterService.handleEnvelope(taggedEnvelope);

    const auditRow = await withTenant(db, tenantId, (tx) =>
      tx.query.auditLog.findFirst({ where: and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, "field.photo.tag")) }),
    );
    expect(auditRow).toBeDefined();
    expect(auditRow!.aiRunId).not.toBeNull();
    expect(auditRow!.entityId).toBe(photo.id);
  });

  it("RAG: a tagged photo becomes searchable by its tag labels, permission-filtered", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("search");
    const photo = await capturePhoto(tenantId, ownerId, project.id);
    await fileProcessingService.process({ fileId: photo.fileId, tenantId });
    await photoAiWriterService.handleEnvelope(await replayLatestOutboxEvent(tenantId, "file.scan_completed.v1"));

    await ragIndexingService.indexEntity(tenantId, "photo", photo.id);
    const results = await ragSearchService.search(tenantId, ownerId, { query: "drywall crack" });
    expect(results.some((r) => r.entityType === "photo" && r.entityId === photo.id)).toBe(true);

    const bystander = await rbacService.inviteUser(tenantId, `photo-ai-bystander-${Date.now()}@example.com`, "Bystander", ownerId);
    const bystanderResults = await ragSearchService.search(tenantId, bystander.userId, { query: "drywall crack" });
    expect(bystanderResults).toEqual([]);
  });

  it("indexing an untagged photo is a silent no-op (nothing to search yet)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("untagged");
    const photo = await capturePhoto(tenantId, ownerId, project.id);
    await expect(ragIndexingService.indexEntity(tenantId, "photo", photo.id)).resolves.toBeUndefined();
  });
});
