import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { costCodes, exportJobs, importJobs, outbox } from "../src/infrastructure/db/schema";
import {
  ImportJobAlreadyCommittedError,
  ImportJobNotFoundError,
  ImportJobNotMappedError,
  ImportJobNotValidatedError,
  InvalidFieldMappingError,
} from "../src/modules/imports-exports/domain/errors";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestImportsExportsServices } from "./setup/imports-exports";
import { buildTestProjectServices } from "./setup/projects";

describe("Imports/Exports v1: guided CSV import (cost_codes) + full CSV export", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const {
    storage,
    fileUploadService,
    fileProcessingService,
    exportsService,
    exportRunnerService,
    importsService,
    queueConnection,
  } = buildTestImportsExportsServices(db);

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
      email: `impexp-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `ImpExp ${label} ${suffix}`,
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

  // Simulates a client uploading a CSV through the existing Files pipeline
  // (presigned single-PUT -> complete -> virus scan) so the import job can
  // reference a real, already-"clean" fileId — same reasoning
  // ImportsService.getFileBuffer's own comment gives for reusing this
  // pipeline rather than building a second upload path.
  async function uploadCsv(tenantId: string, actorId: string, csv: string): Promise<string> {
    const content = Buffer.from(csv, "utf8");
    const result = await fileUploadService.initiateUpload(tenantId, actorId, {
      filename: "cost-codes.csv",
      contentType: "text/csv",
      sizeBytes: content.length,
    });
    if (result.uploadMode !== "single") throw new Error("expected single mode");
    const file = await fileUploadService.getFile(tenantId, result.fileId);
    storage.fakeClientUploadSingle(file.objectKey, content, "text/csv");
    await fileUploadService.completeUpload(tenantId, actorId, result.fileId);
    await fileProcessingService.process({ fileId: result.fileId, tenantId });
    return result.fileId;
  }

  describe("export", () => {
    it("exports cost_codes tenant-wide as CSV via the async job pipeline", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("export-cc");
      await withTenant(db, tenantId, (tx) =>
        tx.insert(costCodes).values([
          { tenantId, projectId: project.id, code: "01", name: "General Conditions", kind: "other", createdBy: ownerId },
          { tenantId, projectId: project.id, code: "02", name: "Sitework", kind: "subcontract", createdBy: ownerId },
        ]),
      );

      const job = await exportsService.requestExport(tenantId, ownerId, "cost_codes");
      expect(job.status).toBe("queued");

      await exportRunnerService.run({ tenantId, actorId: ownerId, exportJobId: job.id, entityType: "cost_codes" });

      const completed = await exportsService.getJob(tenantId, job.id);
      expect(completed.status).toBe("completed");
      expect(completed.rowCount).toBe(2);
      expect(completed.fileId).not.toBeNull();

      const downloadUrl = await exportsService.getDownloadUrl(tenantId, job.id);
      expect(downloadUrl).toContain("fake://download/");

      const stored = storage.getStoredObject((await fileUploadService.getFile(tenantId, completed.fileId!)).objectKey);
      expect(stored?.buffer.toString("utf8")).toContain("General Conditions");
      expect(stored?.buffer.toString("utf8")).toContain("Sitework");

      const eventTypes = await outboxEventTypes(tenantId);
      expect(eventTypes).toContain("export_job.requested.v1");
    });

    it("exports another registered entity type (tasks) via the same registry dispatch", async () => {
      const { tenantId, ownerId } = await signUpCompanyWithProject("export-tasks");

      const job = await exportsService.requestExport(tenantId, ownerId, "tasks");
      await exportRunnerService.run({ tenantId, actorId: ownerId, exportJobId: job.id, entityType: "tasks" });

      const completed = await exportsService.getJob(tenantId, job.id);
      expect(completed.status).toBe("completed");
      expect(completed.rowCount).toBe(0); // no tasks created in this test
    });

    it("RLS: a tenant only sees its own export_jobs", async () => {
      const a = await signUpCompanyWithProject("export-rls-a");
      const b = await signUpCompanyWithProject("export-rls-b");
      await exportsService.requestExport(a.tenantId, a.ownerId, "projects");

      const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.exportJobs.findMany());
      expect(rowsB).toHaveLength(0);

      const rowsA = await withTenant(db, a.tenantId, (tx) => tx.query.exportJobs.findMany({ where: eq(exportJobs.tenantId, a.tenantId) }));
      expect(rowsA.length).toBeGreaterThan(0);
    });
  });

  describe("import", () => {
    it("full pipeline: upload -> map -> validate (clean) -> commit creates real cost codes", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("import-happy");
      const csv = "Cost Code,Description,Type\n01,General Conditions,other\n02,Sitework,subcontract\n";
      const fileId = await uploadCsv(tenantId, ownerId, csv);

      const job = await importsService.create(tenantId, ownerId, {
        entityType: "cost_codes",
        projectId: project.id,
        fileId,
      });
      expect(job.status).toBe("uploaded");

      const mapped = await importsService.map(tenantId, ownerId, job.id, {
        fieldMapping: { code: "Cost Code", name: "Description", kind: "Type" },
      });
      expect(mapped.status).toBe("mapped");

      const validated = await importsService.validate(tenantId, ownerId, job.id);
      expect(validated.status).toBe("validated");
      expect(validated.validationReport).toMatchObject({ totalRows: 2, validRows: 2, errors: [] });

      const committed = await importsService.commit(tenantId, ownerId, job.id);
      expect(committed.status).toBe("committed");
      expect(committed.commitResult).toMatchObject({ created: 2, skipped: 0 });

      const rows = await withTenant(db, tenantId, (tx) =>
        tx.query.costCodes.findMany({ where: eq(costCodes.projectId, project.id) }),
      );
      expect(rows.map((r) => r.code).sort()).toEqual(["01", "02"]);

      const eventTypes = await outboxEventTypes(tenantId);
      expect(eventTypes).toContain("import_job.committed.v1");
    });

    it("validate reports per-row errors for an invalid kind, and commit skips just that row", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("import-bad-row");
      const csv = "Cost Code,Description,Type\n01,General Conditions,other\n02,Sitework,not-a-real-kind\n";
      const fileId = await uploadCsv(tenantId, ownerId, csv);

      const job = await importsService.create(tenantId, ownerId, { entityType: "cost_codes", projectId: project.id, fileId });
      await importsService.map(tenantId, ownerId, job.id, {
        fieldMapping: { code: "Cost Code", name: "Description", kind: "Type" },
      });
      const validated = await importsService.validate(tenantId, ownerId, job.id);
      expect(validated.validationReport).toMatchObject({ totalRows: 2, validRows: 1 });
      expect((validated.validationReport as { errors: unknown[] }).errors).toHaveLength(1);

      const committed = await importsService.commit(tenantId, ownerId, job.id);
      expect(committed.commitResult).toMatchObject({ created: 1, skipped: 1 });

      const rows = await withTenant(db, tenantId, (tx) =>
        tx.query.costCodes.findMany({ where: eq(costCodes.projectId, project.id) }),
      );
      expect(rows.map((r) => r.code)).toEqual(["01"]);
    });

    it("rejects a field mapping missing a required target field", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("import-bad-map");
      const fileId = await uploadCsv(tenantId, ownerId, "Cost Code,Description\n01,GC\n");
      const job = await importsService.create(tenantId, ownerId, { entityType: "cost_codes", projectId: project.id, fileId });

      await expect(
        importsService.map(tenantId, ownerId, job.id, { fieldMapping: { code: "Cost Code" } }),
      ).rejects.toThrow(InvalidFieldMappingError);
    });

    it("enforces the upload -> map -> validate -> commit pipeline order", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("import-order");
      const fileId = await uploadCsv(tenantId, ownerId, "Cost Code,Description,Type\n01,GC,other\n");
      const job = await importsService.create(tenantId, ownerId, { entityType: "cost_codes", projectId: project.id, fileId });

      await expect(importsService.validate(tenantId, ownerId, job.id)).rejects.toThrow(ImportJobNotMappedError);
      await expect(importsService.commit(tenantId, ownerId, job.id)).rejects.toThrow(ImportJobNotValidatedError);

      await importsService.map(tenantId, ownerId, job.id, {
        fieldMapping: { code: "Cost Code", name: "Description", kind: "Type" },
      });
      await expect(importsService.commit(tenantId, ownerId, job.id)).rejects.toThrow(ImportJobNotValidatedError);

      await importsService.validate(tenantId, ownerId, job.id);
      await importsService.commit(tenantId, ownerId, job.id);
      await expect(importsService.commit(tenantId, ownerId, job.id)).rejects.toThrow(ImportJobAlreadyCommittedError);
    });

    it("throws for an unknown import job id", async () => {
      const { tenantId } = await signUpCompanyWithProject("import-missing");
      await expect(importsService.getJob(tenantId, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        ImportJobNotFoundError,
      );
    });

    it("RLS: a tenant only sees its own import_jobs", async () => {
      const a = await signUpCompanyWithProject("import-rls-a");
      const b = await signUpCompanyWithProject("import-rls-b");
      const fileId = await uploadCsv(a.tenantId, a.ownerId, "Cost Code,Description,Type\n01,GC,other\n");
      await importsService.create(a.tenantId, a.ownerId, { entityType: "cost_codes", projectId: a.project.id, fileId });

      const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.importJobs.findMany());
      expect(rowsB).toHaveLength(0);

      const rowsA = await withTenant(db, a.tenantId, (tx) => tx.query.importJobs.findMany({ where: eq(importJobs.tenantId, a.tenantId) }));
      expect(rowsA.length).toBeGreaterThan(0);
    });
  });
});
