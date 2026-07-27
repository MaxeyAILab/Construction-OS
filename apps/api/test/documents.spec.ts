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
  const {
    foldersService,
    documentsService,
    versionsService,
    drawingSetsService,
    drawingDiffService,
    drawingDiffAiProvider,
    cacheRedis,
  } = buildTestDocumentServices(db, fileUploadService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await queueConnection.quit();
    await cacheRedis.quit();
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

    const all = await documentsService.list(tenantId, ownerId, project.id, { limit: 20 });
    expect(all.data.map((d) => d.id).sort()).toEqual([filed.id, unfiled.id].sort());

    const searched = await documentsService.list(tenantId, ownerId, project.id, { limit: 20, q: "Foundation" });
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

    let fetched = await documentsService.getById(tenantId, ownerId, document.id);
    expect(fetched.currentVersionId).toBe(v1.id);
    expect(fetched.versions).toHaveLength(1);

    const v2 = await uploadVersion(tenantId, ownerId, document.id, Buffer.from("v2 content"), "spec-v2.txt", true);
    expect(v2.versionNo).toBe(2);

    fetched = await documentsService.getById(tenantId, ownerId, document.id);
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

    await expect(versionsService.getDownloadUrl(tenantId, ownerId, version.id)).rejects.toThrow(/not downloadable/);

    await fileProcessingService.process({
      fileId: (await documentsService.getById(tenantId, ownerId, document.id)).versions[0]!.fileId,
      tenantId,
    });
    const url = await versionsService.getDownloadUrl(tenantId, ownerId, version.id);
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

  it("drawing set diff: auto-selects the prior set and classifies added/removed/revised sheets", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("diffauto");

    const docA101 = await documentsService.create(tenantId, ownerId, project.id, { name: "A-101", category: "drawing" });
    const a101v1 = await uploadVersion(tenantId, ownerId, docA101.id, Buffer.from("a101 v1"), "a101-v1.pdf", true);
    const docA102 = await documentsService.create(tenantId, ownerId, project.id, { name: "A-102", category: "drawing" });
    const a102v1 = await uploadVersion(tenantId, ownerId, docA102.id, Buffer.from("a102 v1"), "a102-v1.pdf", true);

    const setA = await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "IFC 2026-03-01",
      sheets: [{ documentVersionId: a101v1.id }, { documentVersionId: a102v1.id }],
    });

    const a101v2 = await uploadVersion(tenantId, ownerId, docA101.id, Buffer.from("a101 v2"), "a101-v2.pdf", true);
    const docA103 = await documentsService.create(tenantId, ownerId, project.id, { name: "A-103", category: "drawing" });
    const a103v1 = await uploadVersion(tenantId, ownerId, docA103.id, Buffer.from("a103 v1"), "a103-v1.pdf", true);

    const setB = await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "IFC 2026-04-01",
      sheets: [{ documentVersionId: a101v2.id }, { documentVersionId: a103v1.id }],
    });

    const result = await drawingDiffService.diff(tenantId, ownerId, setB.id, {});

    expect(result.comparedToDrawingSetId).toBe(setA.id);
    expect(result.added.map((s) => s.documentId)).toEqual([docA103.id]);
    expect(result.removed.map((s) => s.documentId)).toEqual([docA102.id]);
    expect(result.revised).toHaveLength(1);
    expect(result.revised[0]!.documentId).toBe(docA101.id);
    expect(result.revised[0]!.versionNo).toBe(2);
    expect(result.revised[0]!.priorVersionNo).toBe(1);
    expect(result.unchangedCount).toBe(0);
  });

  it("drawing set diff: honors an explicit compareToDrawingSetId", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("diffexplicit");

    const doc = await documentsService.create(tenantId, ownerId, project.id, { name: "S-101", category: "drawing" });
    const v1 = await uploadVersion(tenantId, ownerId, doc.id, Buffer.from("s101 v1"), "s101-v1.pdf", true);
    const setA = await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "Set A",
      sheets: [{ documentVersionId: v1.id }],
    });

    const v2 = await uploadVersion(tenantId, ownerId, doc.id, Buffer.from("s101 v2"), "s101-v2.pdf", true);
    await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "Set B",
      sheets: [{ documentVersionId: v2.id }],
    });

    // A third set identical to B, so the "most recent prior" auto-pick
    // would land on B rather than A if compareToDrawingSetId weren't honored.
    const setC = await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "Set C",
      sheets: [{ documentVersionId: v2.id }],
    });

    const result = await drawingDiffService.diff(tenantId, ownerId, setC.id, { compareToDrawingSetId: setA.id });
    expect(result.comparedToDrawingSetId).toBe(setA.id);
    expect(result.revised).toHaveLength(1);
    expect(result.revised[0]!.priorVersionNo).toBe(1);
  });

  it("drawing set diff: throws when the project has no prior drawing set to compare against", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("diffnoprior");
    const doc = await documentsService.create(tenantId, ownerId, project.id, { name: "Lone Sheet", category: "drawing" });
    const version = await uploadVersion(tenantId, ownerId, doc.id, Buffer.from("bytes"), "lone.pdf", true);
    const onlySet = await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "Only Set",
      sheets: [{ documentVersionId: version.id }],
    });

    await expect(drawingDiffService.diff(tenantId, ownerId, onlySet.id, {})).rejects.toThrow(/no prior/);
  });

  it("drawing set diff: AI summary is populated on success and degrades gracefully on failure", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("diffai");

    const doc = await documentsService.create(tenantId, ownerId, project.id, { name: "M-101", category: "drawing" });
    const v1 = await uploadVersion(tenantId, ownerId, doc.id, Buffer.from("m101 v1"), "m101-v1.pdf", true);
    await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "Set A",
      sheets: [{ documentVersionId: v1.id }],
    });
    const v2 = await uploadVersion(tenantId, ownerId, doc.id, Buffer.from("m101 v2"), "m101-v2.pdf", true);
    const setB = await drawingSetsService.create(tenantId, ownerId, project.id, {
      name: "Set B",
      sheets: [{ documentVersionId: v2.id }],
    });

    drawingDiffAiProvider.setResponse({ content: "M-101 was revised.", inputTokens: 42, outputTokens: 8 });
    const okResult = await drawingDiffService.diff(tenantId, ownerId, setB.id, {});
    expect(okResult.summary).toBe("M-101 was revised.");
    expect(okResult.aiRunId).not.toBeNull();

    drawingDiffAiProvider.setShouldThrow(true);
    const failedResult = await drawingDiffService.diff(tenantId, ownerId, setB.id, {});
    expect(failedResult.summary).toBeNull();
    expect(failedResult.aiRunId).toBeNull();
    expect(failedResult.added).toEqual(okResult.added);
    drawingDiffAiProvider.setShouldThrow(false);
  });

  it("RLS: a tenant only sees its own documents", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await documentsService.create(a.tenantId, a.ownerId, a.project.id, { name: "A doc", category: "other" });

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.documents.findMany());
    expect(rowsB).toHaveLength(0);
  });
});
