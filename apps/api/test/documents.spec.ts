import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestDocumentServices } from "./setup/documents";
import { buildTestFileServices } from "./setup/files";
import { buildTestProjectServices } from "./setup/projects";

describe("Documents v1", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { storage, fileUploadService, fileProcessingService, queueConnection } = buildTestFileServices(db);
  const { foldersService, documentsService, versionsService, drawingSetsService } = buildTestDocumentServices(
    db,
    fileUploadService,
  );

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
      email: `docs-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Docs ${label} ${suffix}`,
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
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    );
    return rows.map((r) => r.eventType);
  }

  // Drives a version through initiate -> fake client upload -> complete ->
  // (optionally) processing, mirroring files.spec.ts's approach of calling
  // fileProcessingService.process directly instead of running the real
  // BullMQ worker loop.
  async function uploadVersion(
    tenantId: string,
    actorId: string,
    documentId: string,
    content: Buffer,
    filename: string,
    processToClean: boolean,
  ) {
    const initiated = await versionsService.initiateVersion(tenantId, actorId, documentId, {
      filename,
      contentType: "text/plain",
      sizeBytes: content.length,
    });
    if (initiated.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(tenantId, initiated.fileId);
    storage.fakeClientUploadSingle(file.objectKey, content, "text/plain");

    const version = await versionsService.completeVersion(tenantId, actorId, documentId, { fileId: initiated.fileId });
    if (processToClean) {
      await fileProcessingService.process({ fileId: initiated.fileId, tenantId });
    }
    return version;
  }

  it("creates a folder and documents (filed and unfiled), and lists with ?q= search", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("crud");
    const folder = await foldersService.create(tenantId, ownerId, project.id, { name: "Drawings" });
    expect(folder.parentId).toBeNull();

    const filed = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Foundation Plan",
      category: "drawing",
      folderId: folder.id,
    });
    const unfiled = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Random note",
      category: "other",
    });
    expect(unfiled.folderId).toBeNull();

    const all = await documentsService.list(tenantId, project.id, { limit: 20 });
    expect(all.data.map((d) => d.id).sort()).toEqual([filed.id, unfiled.id].sort());

    const searched = await documentsService.list(tenantId, project.id, { limit: 20, q: "Foundation" });
    expect(searched.data).toHaveLength(1);
    expect(searched.data[0]!.id).toBe(filed.id);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("folder.created.v1");
    expect(eventTypes).toContain("document.created.v1");
  });

  it("uploads versions reusing the Files pipeline: numbering, immutability, and current_version_id promotion", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("versions");
    const document = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Spec Section 03",
      category: "spec",
    });

    const v1 = await uploadVersion(tenantId, ownerId, document.id, Buffer.from("v1 content"), "spec-v1.txt", true);
    expect(v1.versionNo).toBe(1);

    let fetched = await documentsService.getById(tenantId, document.id);
    expect(fetched.currentVersionId).toBe(v1.id);
    expect(fetched.versions).toHaveLength(1);

    const v2 = await uploadVersion(tenantId, ownerId, document.id, Buffer.from("v2 content"), "spec-v2.txt", true);
    expect(v2.versionNo).toBe(2);

    fetched = await documentsService.getById(tenantId, document.id);
    expect(fetched.currentVersionId).toBe(v2.id);
    expect(fetched.versions).toHaveLength(2);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("document_version.created.v1");
    expect(eventTypes).toContain("document.updated.v1");
  });

  it("gates downloads on the file's scan status (not downloadable until clean)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("download");
    const document = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Permit",
      category: "permit",
    });
    const version = await uploadVersion(tenantId, ownerId, document.id, Buffer.from("permit bytes"), "permit.txt", false);

    await expect(versionsService.getDownloadUrl(tenantId, version.id)).rejects.toThrow(/not downloadable/);

    await fileProcessingService.process({ fileId: (await documentsService.getById(tenantId, document.id)).versions[0]!.fileId, tenantId });
    const url = await versionsService.getDownloadUrl(tenantId, version.id);
    expect(url).toContain("fake://download/");
  });

  it("drawing sets: creates with sheets and publishing un-publishes the prior set", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("drawingsets");
    const document = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Sheet A-101",
      category: "drawing",
    });
    const version = await uploadVersion(tenantId, ownerId, document.id, Buffer.from("drawing bytes"), "a101.pdf", true);

    const setA = await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "IFC 2026-03-01",
      sheets: [{ documentVersionId: version.id }],
    });
    expect(setA.sheets).toHaveLength(1);
    expect(setA.isPublished).toBe(false);

    const publishedA = await drawingSetsService.publish(tenantId, ownerId, setA.id);
    expect(publishedA.isPublished).toBe(true);

    const setB = await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "IFC 2026-04-01",
      sheets: [{ documentVersionId: version.id }],
    });
    const publishedB = await drawingSetsService.publish(tenantId, ownerId, setB.id);
    expect(publishedB.isPublished).toBe(true);

    const setAAfter = await drawingSetsService.getById(tenantId, setA.id);
    expect(setAAfter.isPublished).toBe(false);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("drawing_set.created.v1");
    expect(eventTypes).toContain("drawing_set.published.v1");
  });

  it("RLS: a tenant only sees its own documents", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await documentsService.create(a.tenantId, a.ownerId, a.project.id, { name: "A doc", category: "other" });

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.documents.findMany());
    expect(rowsB).toHaveLength(0);
  });
});
