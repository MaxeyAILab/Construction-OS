import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { buildTestAuthService } from "./setup/auth";
import { buildTestDocumentServices } from "./setup/documents";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestExternalSharesService } from "./setup/external-shares";
import { buildTestFileServices } from "./setup/files";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";
import { buildTestSubcontractorServices } from "./setup/subcontractors";
import { buildTestTasksServices } from "./setup/tasks";
import { buildTestWarrantyCloseoutServices } from "./setup/warranty-closeout";

// spec.md §13.18 / api.md §18 (M19 Warranty & Closeout Management).
describe("Warranty & Closeout Management (M19)", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const { externalSharesService } = buildTestExternalSharesService(db);
  const { tasksService } = buildTestTasksServices(db);
  const { fileUploadService, queueConnection } = buildTestFileServices(db);
  const { documentsService } = buildTestDocumentServices(db, fileUploadService);
  const { subcontractorsService } = buildTestSubcontractorServices(db);
  const { checklistService, packagesService, warrantiesService, claimsService, cacheRedis } =
    buildTestWarrantyCloseoutServices(db, fileUploadService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await rbacRedis.quit();
    await cacheRedis.quit();
    await queueConnection.quit();
  });

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `warranty-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Warranty ${label} ${suffix}`,
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

  async function inviteExternalUser(tenantId: string, actorId: string, label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId } = await rbacService.inviteUser(tenantId, `${label}-${suffix}@example.com`, "Client", actorId, "external");
    return userId;
  }

  function isoDate(daysFromNow: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString().slice(0, 10);
  }

  describe("Closeout checklist (FR-CLOSE-1)", () => {
    it("creates a checklist item and marks it complete with a linked document", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("checklist");
      const document = await documentsService.create(tenantId, ownerId, project.id, {
        name: "As-built drawings.pdf",
        category: "drawing",
      });

      const item = await checklistService.create(tenantId, ownerId, project.id, {
        category: "as_built_drawings",
        title: "As-built drawing set",
      });
      expect(item.status).toBe("pending");

      const updated = await checklistService.update(tenantId, ownerId, item.id, {
        status: "complete",
        documentId: document.id,
      });
      expect(updated.status).toBe("complete");
      expect(updated.completedAt).toBeTruthy();
      expect(updated.documentId).toBe(document.id);

      const list = await checklistService.list(tenantId, project.id);
      expect(list).toHaveLength(1);
    });
  });

  describe("Closeout package assembly (FR-CLOSE-2/3)", () => {
    it("blocks assembly while the checklist is incomplete, then while punch is open, then succeeds", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("assemble");

      const item = await checklistService.create(tenantId, ownerId, project.id, {
        category: "om_manuals",
        title: "O&M manuals",
      });
      const punch = await tasksService.create(tenantId, ownerId, {
        projectId: project.id,
        title: "Touch up paint in unit 3",
        kind: "punch",
      });

      await expect(packagesService.assemble(tenantId, ownerId, project.id)).rejects.toThrow(/checklist/i);

      await checklistService.update(tenantId, ownerId, item.id, { status: "complete" });
      await expect(packagesService.assemble(tenantId, ownerId, project.id)).rejects.toThrow(/punch/i);

      await tasksService.update(tenantId, ownerId, punch.id, { status: "done" });
      const created = await packagesService.assemble(tenantId, ownerId, project.id);
      expect(created.status).toBe("assembled");
      expect(created.fileId).toBeTruthy();

      const status = await packagesService.getStatus(tenantId, project.id);
      expect(status.currentStatus).toBe("assembled");
      expect(status.history).toHaveLength(1);
    });

    it("a cancelled punch item does not block assembly", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("cancelled-punch");
      const punch = await tasksService.create(tenantId, ownerId, {
        projectId: project.id,
        title: "Duplicate punch item",
        kind: "punch",
      });
      await tasksService.update(tenantId, ownerId, punch.id, { status: "cancelled" });

      const created = await packagesService.assemble(tenantId, ownerId, project.id);
      expect(created.status).toBe("assembled");
    });
  });

  describe("Warranties (FR-CLOSE-4)", () => {
    it("computes due-state from start_date + duration_months", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("due-state");
      const subcontractor = await subcontractorsService.create(tenantId, ownerId, { name: "Roofing Co" });

      const active = await warrantiesService.create(tenantId, ownerId, project.id, {
        scope: "Roofing system",
        warrantyType: "manufacturer",
        responsiblePartyType: "subcontractor",
        responsibleSubcontractorId: subcontractor.id,
        startDate: isoDate(0),
        durationMonths: 24,
      });
      expect(active.dueState).toBe("active");

      const expiringSoon = await warrantiesService.create(tenantId, ownerId, project.id, {
        scope: "HVAC labor",
        warrantyType: "labor",
        responsiblePartyType: "subcontractor",
        responsibleSubcontractorId: subcontractor.id,
        startDate: isoDate(-355),
        durationMonths: 12, // ends comfortably inside the 30-day window, safe against month-length variance
      });
      expect(expiringSoon.dueState).toBe("expiring_soon");

      const expired = await warrantiesService.create(tenantId, ownerId, project.id, {
        scope: "Paint",
        warrantyType: "material",
        responsiblePartyType: "manufacturer",
        startDate: isoDate(-800),
        durationMonths: 12,
      });
      expect(expired.dueState).toBe("expired");

      const filtered = await warrantiesService.list(tenantId, project.id, { limit: 20, dueState: "expired" });
      expect(filtered.map((w) => w.id)).toEqual([expired.id]);
    });
  });

  describe("Warranty claims (FR-CLOSE-5)", () => {
    async function createActiveWarranty(tenantId: string, ownerId: string, projectId: string) {
      return warrantiesService.create(tenantId, ownerId, projectId, {
        scope: "Windows",
        warrantyType: "manufacturer",
        responsiblePartyType: "manufacturer",
        startDate: isoDate(0),
        durationMonths: 60,
      });
    }

    it("an internal user with closeout.claim.create can file a claim", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("claim-internal");
      const warranty = await createActiveWarranty(tenantId, ownerId, project.id);

      const claim = await claimsService.create(tenantId, ownerId, warranty.id, { description: "Window seal leaking" });
      expect(claim.status).toBe("submitted");

      const list = await claimsService.list(tenantId, ownerId, warranty.id);
      expect(list).toHaveLength(1);
    });

    it("rejects a caller with neither permission nor a project share", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("claim-deny");
      const warranty = await createActiveWarranty(tenantId, ownerId, project.id);
      const bystanderId = await inviteExternalUser(tenantId, ownerId, "bystander");

      await expect(claimsService.create(tenantId, bystanderId, warranty.id, { description: "x" })).rejects.toThrow(
        /closeout\.claim/,
      );
    });

    it("a client with a project-level 'comment' share can file a claim", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("claim-share");
      const warranty = await createActiveWarranty(tenantId, ownerId, project.id);
      const clientId = await inviteExternalUser(tenantId, ownerId, "client");
      await externalSharesService.create(tenantId, ownerId, {
        principalUserId: clientId,
        audience: "client",
        entityType: "project",
        entityId: project.id,
        access: "comment",
      });

      const claim = await claimsService.create(tenantId, clientId, warranty.id, { description: "Window won't close" });
      expect(claim.status).toBe("submitted");
    });

    it("rejects filing a claim against an expired warranty", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("claim-expired");
      const warranty = await warrantiesService.create(tenantId, ownerId, project.id, {
        scope: "Old roof",
        warrantyType: "material",
        responsiblePartyType: "manufacturer",
        startDate: isoDate(-800),
        durationMonths: 12,
      });

      await expect(claimsService.create(tenantId, ownerId, warranty.id, { description: "Too late" })).rejects.toThrow(
        /expired/i,
      );
    });

    it("moves a claim through its lifecycle and rejects an illegal transition", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("claim-lifecycle");
      const warranty = await createActiveWarranty(tenantId, ownerId, project.id);
      const claim = await claimsService.create(tenantId, ownerId, warranty.id, { description: "Draft in frame" });

      const acknowledged = await claimsService.update(tenantId, ownerId, claim.id, { status: "acknowledged" });
      expect(acknowledged.status).toBe("acknowledged");

      await expect(claimsService.update(tenantId, ownerId, claim.id, { status: "resolved" })).rejects.toThrow(/cannot move/i);

      const inProgress = await claimsService.update(tenantId, ownerId, claim.id, { status: "in_progress" });
      const resolved = await claimsService.update(tenantId, ownerId, inProgress.id, {
        status: "resolved",
        resolutionNotes: "Replaced seal",
      });
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolvedAt).toBeTruthy();
    });
  });
});
