import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestDocumentServices } from "./setup/documents";
import { buildTestFileServices } from "./setup/files";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";
import { buildTestTransmittalsServices } from "./setup/transmittals";

// database.md §25 / api.md §20 (M3, FR-DOC-8/9). Guard-rails under test:
// transmittal draft->sent lifecycle + recipient-only acknowledge, and the
// approval chain's sequential-only, current-approver-only, no-branching
// decide() logic.
describe("Advanced Document Workflows (M3)", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { rbacService, permissionResolver, redis: rbacRedis } = buildTestRbacServices(db);
  const { projectsService } = buildTestProjectServices(db);
  const { fileUploadService, storage, fileProcessingService, queueConnection } = buildTestFileServices(db);
  const { documentsService, versionsService, cacheRedis } = buildTestDocumentServices(db, fileUploadService);
  const { transmittalsService, matricesService, instancesService } = buildTestTransmittalsServices(
    db,
    permissionResolver,
  );

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

  async function signUpCompanyWithProjectAndVersion(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `dw-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `DW ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    const document = await documentsService.create(signUp.companyId, ownerId, project.id, {
      name: "Spec section.pdf",
      category: "spec",
    });
    const content = Buffer.from("%PDF-1.4 fake");
    const initiated = await versionsService.initiateVersion(signUp.companyId, ownerId, document.id, {
      filename: "spec.pdf",
      contentType: "application/pdf",
      sizeBytes: content.length,
    });
    if (initiated.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(signUp.companyId, initiated.fileId);
    storage.fakeClientUploadSingle(file.objectKey, content, "application/pdf");
    const version = await versionsService.completeVersion(signUp.companyId, ownerId, document.id, {
      fileId: initiated.fileId,
    });
    await fileProcessingService.process({ fileId: initiated.fileId, tenantId: signUp.companyId });
    return { tenantId: signUp.companyId, ownerId, project, document, version };
  }

  async function outboxPayload(tenantId: string, eventType: string) {
    const row = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findFirst({
        where: and(eq(outbox.tenantId, tenantId), eq(outbox.eventType, eventType)),
        orderBy: (o, { desc }) => [desc(o.occurredAt)],
      }),
    );
    if (!row) throw new Error(`no ${eventType} outbox row found for tenant ${tenantId}`);
    return row.payload as Record<string, unknown>;
  }

  describe("Transmittals (FR-DOC-8)", () => {
    it("creates a draft, sends it (notifying recipients), and rejects a second send", async () => {
      const { tenantId, ownerId, project, version } = await signUpCompanyWithProjectAndVersion("send");
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const recipient = await rbacService.inviteUser(tenantId, `recip-${suffix}@example.com`, "Recipient", ownerId);

      const transmittal = await transmittalsService.create(tenantId, ownerId, project.id, {
        purpose: "for_review",
        subject: "Please review spec section",
        items: [{ documentVersionId: version.id }],
        recipientUserIds: [recipient.userId],
      });
      expect(transmittal.status).toBe("draft");
      expect(transmittal.number).toBe(1);

      await transmittalsService.send(tenantId, ownerId, transmittal.id);
      const payload = await outboxPayload(tenantId, "transmittal.sent.v1");
      expect(payload.notifyUserIds).toEqual([recipient.userId]);

      await expect(transmittalsService.send(tenantId, ownerId, transmittal.id)).rejects.toThrow(/draft/i);
    });

    it("lets a recipient acknowledge but rejects a non-recipient", async () => {
      const { tenantId, ownerId, project, version } = await signUpCompanyWithProjectAndVersion("ack");
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const recipient = await rbacService.inviteUser(tenantId, `recip2-${suffix}@example.com`, "Recipient", ownerId);
      const bystander = await rbacService.inviteUser(tenantId, `bystander-${suffix}@example.com`, "Bystander", ownerId);

      const transmittal = await transmittalsService.create(tenantId, ownerId, project.id, {
        purpose: "for_record",
        subject: "FYI",
        items: [{ documentVersionId: version.id }],
        recipientUserIds: [recipient.userId],
      });
      await transmittalsService.send(tenantId, ownerId, transmittal.id);

      await expect(transmittalsService.acknowledge(tenantId, bystander.userId, transmittal.id)).rejects.toThrow(
        /not a recipient/i,
      );

      const acked = await transmittalsService.acknowledge(tenantId, recipient.userId, transmittal.id);
      expect(acked.acknowledgedAt).not.toBeNull();
    });
  });

  describe("Approval matrices (FR-DOC-9)", () => {
    it("runs a two-step chain sequentially, notifying only the current step's named approver", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProjectAndVersion("chain");
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const approverA = await rbacService.inviteUser(tenantId, `approverA-${suffix}@example.com`, "Approver A", ownerId);
      const approverB = await rbacService.inviteUser(tenantId, `approverB-${suffix}@example.com`, "Approver B", ownerId);

      const matrix = await matricesService.create(tenantId, ownerId, {
        entityType: "document",
        name: "Two-step sign-off",
        steps: [
          { stepOrder: 1, approverUserId: approverA.userId },
          { stepOrder: 2, approverUserId: approverB.userId },
        ],
      });

      const instance = await instancesService.start(tenantId, ownerId, {
        approvalMatrixId: matrix.id,
        entityType: "document",
        entityId: project.id,
      });
      expect(instance.currentStepOrder).toBe(1);

      // Starting a second chain on the same entity while one is in
      // progress is rejected (at most one active chain per entity).
      await expect(
        instancesService.start(tenantId, ownerId, {
          approvalMatrixId: matrix.id,
          entityType: "document",
          entityId: project.id,
        }),
      ).rejects.toThrow(/already in progress/i);

      // Only the current step's named approver may decide.
      await expect(
        instancesService.decide(tenantId, approverB.userId, instance.id, { decision: "approved" }),
      ).rejects.toThrow(/not the current step/i);

      await instancesService.decide(tenantId, approverA.userId, instance.id, { decision: "approved" });
      const advancedPayload = await outboxPayload(tenantId, "approval_instance.decided.v1");
      expect(advancedPayload.status).toBe("in_progress");
      expect(advancedPayload.notifyUserId).toBe(approverB.userId);

      const rejected = await instancesService.decide(tenantId, approverB.userId, instance.id, {
        decision: "rejected",
        comments: "Needs rework",
      });
      expect(rejected.status).toBe("rejected");

      await expect(
        instancesService.decide(tenantId, approverB.userId, instance.id, { decision: "approved" }),
      ).rejects.toThrow(/already been decided/i);
    });

    it("rejects starting a chain whose matrix entity_type doesn't match", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProjectAndVersion("mismatch");
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const approver = await rbacService.inviteUser(tenantId, `approver-${suffix}@example.com`, "Approver", ownerId);

      const matrix = await matricesService.create(tenantId, ownerId, {
        entityType: "transmittal",
        name: "Transmittal-only chain",
        steps: [{ stepOrder: 1, approverUserId: approver.userId }],
      });

      await expect(
        instancesService.start(tenantId, ownerId, {
          approvalMatrixId: matrix.id,
          entityType: "document",
          entityId: project.id,
        }),
      ).rejects.toThrow(/entity_type does not match/i);
    });

    it("resolves the per-entity-type permission and denies a caller without it", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProjectAndVersion("perm");
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const approver = await rbacService.inviteUser(tenantId, `approver2-${suffix}@example.com`, "Approver", ownerId);
      const bystander = await rbacService.inviteUser(tenantId, `bystander2-${suffix}@example.com`, "Bystander", ownerId);

      const matrix = await matricesService.create(tenantId, ownerId, {
        entityType: "document",
        name: "Single step",
        steps: [{ stepOrder: 1, approverUserId: approver.userId }],
      });

      await expect(
        instancesService.start(tenantId, bystander.userId, {
          approvalMatrixId: matrix.id,
          entityType: "document",
          entityId: project.id,
        }),
      ).rejects.toThrow(/docs\.document\.update/);
    });
  });
});
