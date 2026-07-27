import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestCrmServices } from "./setup/crm";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestDocumentServices } from "./setup/documents";
import { buildTestFileServices } from "./setup/files";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSubmittalsServices } from "./setup/submittals";

// Submittals + Annotations (FR-DOC-3/FR-DOC-4, database.md §16, api.md §8) —
// the Phase 2 row roadmap.md's own rfis.ts comment flagged as split off
// from RFIs.
describe("Submittals + Annotations", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { storage, fileUploadService, fileProcessingService, queueConnection } = buildTestFileServices(db);
  const { documentsService, versionsService, annotationsService, cacheRedis } = buildTestDocumentServices(
    db,
    fileUploadService,
  );
  const { contactsService } = buildTestCrmServices(db, projectsService);
  const { submittalsService } = buildTestSubmittalsServices(db);

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
      email: `sub-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Submittals ${label} ${suffix}`,
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

  async function uploadVersion(tenantId: string, actorId: string, documentId: string, content: Buffer, filename: string) {
    const initiated = await versionsService.initiateVersion(tenantId, actorId, documentId, {
      filename,
      contentType: "application/pdf",
      sizeBytes: content.length,
    });
    if (initiated.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(tenantId, initiated.fileId);
    storage.fakeClientUploadSingle(file.objectKey, content, "application/pdf");
    const version = await versionsService.completeVersion(tenantId, actorId, documentId, { fileId: initiated.fileId });
    await fileProcessingService.process({ fileId: initiated.fileId, tenantId });
    return version;
  }

  it("creates a submittal with auto-numbering, referencing an existing document (version chain to document_versions)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("create");
    const document = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Concrete Mix Design",
      category: "submittal",
    });

    const submittal = await submittalsService.create(tenantId, ownerId, project.id, {
      specSection: "03 30 00",
      title: "Concrete Mix Design",
      documentId: document.id,
    });
    expect(submittal.number).toBe(1);
    expect(submittal.status).toBe("draft");

    const second = await submittalsService.create(tenantId, ownerId, project.id, {
      specSection: "05 12 00",
      title: "Structural Steel",
      documentId: document.id,
    });
    expect(second.number).toBe(2);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("submittal.created.v1");
  });

  it("rejects a submittal referencing a document from a different project", async () => {
    const { tenantId, ownerId, project: projectA } = await signUpCompanyWithProject("badproj-a");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projectB = await projectsService.create(tenantId, ownerId, {
      name: "Other Project",
      code: `BADPROJ-B-${suffix}`,
      currency: "USD",
    });
    const documentInB = await documentsService.create(tenantId, ownerId, projectB.id, {
      name: "Wrong project doc",
      category: "submittal",
    });

    await expect(
      submittalsService.create(tenantId, ownerId, projectA.id, {
        specSection: "03 30 00",
        title: "Mismatched",
        documentId: documentInB.id,
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("drives the review workflow: draft -> submitted -> reviewed -> approved, and rejects illegal transitions", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("workflow");
    const document = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Curtain Wall Shop Drawings",
      category: "submittal",
    });
    const reviewer = await contactsService.create(tenantId, ownerId, { firstName: "Ada", lastName: "Reviewer" });

    const submittal = await submittalsService.create(tenantId, ownerId, project.id, {
      specSection: "08 44 00",
      title: "Curtain Wall Shop Drawings",
      documentId: document.id,
      reviewerContactId: reviewer.id,
    });

    // Can't skip straight to 'reviewed'.
    await expect(
      submittalsService.update(tenantId, ownerId, submittal.id, { status: "reviewed" }),
    ).rejects.toMatchObject({ code: "illegal_transition", status: 422 });

    const submitted = await submittalsService.update(tenantId, ownerId, submittal.id, { status: "submitted" });
    expect(submitted.status).toBe("submitted");

    const reviewed = await submittalsService.update(tenantId, ownerId, submittal.id, { status: "reviewed" });
    expect(reviewed.status).toBe("reviewed");

    const approved = await submittalsService.update(tenantId, ownerId, submittal.id, {
      status: "approved",
      reviewComments: "Looks good.",
    });
    expect(approved.status).toBe("approved");
    expect(approved.reviewComments).toBe("Looks good.");

    // approved is terminal.
    await expect(
      submittalsService.update(tenantId, ownerId, submittal.id, { status: "submitted" }),
    ).rejects.toMatchObject({ code: "illegal_transition" });

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes.filter((t) => t === "submittal.updated.v1")).toHaveLength(3);
  });

  it("a 'resubmit' decision cycles back to 'submitted' for the next round", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("resubmit");
    const document = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Elevator Equipment",
      category: "submittal",
    });
    const submittal = await submittalsService.create(tenantId, ownerId, project.id, {
      specSection: "14 20 00",
      title: "Elevator Equipment",
      documentId: document.id,
    });

    await submittalsService.update(tenantId, ownerId, submittal.id, { status: "submitted" });
    await submittalsService.update(tenantId, ownerId, submittal.id, { status: "reviewed" });
    const resubmit = await submittalsService.update(tenantId, ownerId, submittal.id, {
      status: "resubmit",
      reviewComments: "Provide updated voltage spec.",
    });
    expect(resubmit.status).toBe("resubmit");

    const resubmitted = await submittalsService.update(tenantId, ownerId, submittal.id, { status: "submitted" });
    expect(resubmitted.status).toBe("submitted");
  });

  it("adds markup annotations to a document version and lists them (FR-DOC-3)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("annotations");
    const document = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Sheet A-101",
      category: "drawing",
    });
    const version = await uploadVersion(tenantId, ownerId, document.id, Buffer.from("drawing bytes"), "a101.pdf");

    const box = await annotationsService.create(tenantId, ownerId, version.id, {
      kind: "box",
      geometry: { x: 10, y: 20, width: 100, height: 50 },
    });
    expect(box.page).toBe(1);
    expect(box.kind).toBe("box");

    const text = await annotationsService.create(tenantId, ownerId, version.id, {
      page: 2,
      kind: "text",
      geometry: { x: 5, y: 5, label: "See detail 3/A-501" },
    });
    expect(text.page).toBe(2);

    const list = await annotationsService.list(tenantId, version.id);
    expect(list.map((a) => a.id).sort()).toEqual([box.id, text.id].sort());

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes.filter((t) => t === "annotation.created.v1")).toHaveLength(2);
  });

  it("rejects an annotation kind outside the markup toolbar enum", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("badkind");
    const document = await documentsService.create(tenantId, ownerId, project.id, {
      name: "Sheet A-102",
      category: "drawing",
    });
    const version = await uploadVersion(tenantId, ownerId, document.id, Buffer.from("drawing bytes"), "a102.pdf");

    // @ts-expect-error deliberately invalid kind to prove the DB check
    // constraint (not just zod) rejects it — mirrors other CHECK-backed
    // enum probes in this suite.
    await expect(annotationsService.create(tenantId, ownerId, version.id, { kind: "sticky_note", geometry: {} })).rejects.toThrow();
  });

  it("RLS: a tenant only sees its own submittals and annotations", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const documentA = await documentsService.create(a.tenantId, a.ownerId, a.project.id, {
      name: "A submittal doc",
      category: "submittal",
    });
    await submittalsService.create(a.tenantId, a.ownerId, a.project.id, {
      specSection: "01 00 00",
      title: "A submittal",
      documentId: documentA.id,
    });

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.submittals.findMany());
    expect(rowsB).toHaveLength(0);

    const versionA = await uploadVersion(a.tenantId, a.ownerId, documentA.id, Buffer.from("bytes"), "doc.pdf");
    await annotationsService.create(a.tenantId, a.ownerId, versionA.id, { kind: "pen", geometry: { points: [] } });
    const annotationsB = await withTenant(db, b.tenantId, (tx) => tx.query.annotations.findMany());
    expect(annotationsB).toHaveLength(0);
  });
});
