import { Inject, Injectable } from "@nestjs/common";
import { createCostCodeSchema } from "@constructionos/schemas";
import type { CreateImportJobInput, MapImportJobInput } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { importJobs } from "../../../infrastructure/db/schema";
import { CostCodesService } from "../../projects";
import { DomainError } from "../../../platform/domain-error";
import { FileUploadService } from "../../files";
import { OutboxService } from "../../events";
import { csvToRecords } from "../domain/csv";
import {
  ImportJobAlreadyCommittedError,
  ImportJobNotFoundError,
  ImportJobNotMappedError,
  ImportJobNotValidatedError,
  InvalidFieldMappingError,
} from "../domain/errors";

// v1 supports entity_type='cost_codes' only (import_jobs' own schema
// comment explains why parentId/hierarchy resolution isn't in this pass) —
// a single inline path rather than a registry abstraction like exporters.ts,
// since there's only one case; extract a registry when a second entity
// type actually needs one (three similar lines beats a premature
// abstraction, CLAUDE.md's own engineering standard).
const costCodeRowSchema = createCostCodeSchema.omit({ parentId: true });
const REQUIRED_TARGET_FIELDS = ["code", "name", "kind"] as const;
const ALL_TARGET_FIELDS = ["code", "name", "division", "kind"] as const;

// api.md §14: "Guided import: upload -> POST /imports/{id}/map -> /validate
// (dry-run report) -> /commit (202)". Each step requires the previous one's
// output — enforced via import_jobs.status, not just client discipline.
@Injectable()
export class ImportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly fileUpload: FileUploadService,
    private readonly costCodes: CostCodesService,
  ) {}

  async create(tenantId: string, actorId: string, input: CreateImportJobInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(importJobs)
        .values({
          tenantId,
          entityType: input.entityType,
          projectId: input.projectId,
          fileId: input.fileId,
          status: "uploaded",
          createdBy: actorId,
        })
        .returning();
      return row!;
    });
  }

  async getJob(tenantId: string, importJobId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const job = await tx.query.importJobs.findFirst({ where: eq(importJobs.id, importJobId) });
      if (!job) throw new ImportJobNotFoundError();
      return job;
    });
  }

  async map(tenantId: string, actorId: string, importJobId: string, input: MapImportJobInput) {
    await this.getJob(tenantId, importJobId);

    const targetFields = Object.keys(input.fieldMapping);
    const unknown = targetFields.filter((f) => !(ALL_TARGET_FIELDS as readonly string[]).includes(f));
    if (unknown.length > 0) {
      throw new InvalidFieldMappingError(`unknown target field(s): ${unknown.join(", ")}`);
    }
    const missing = REQUIRED_TARGET_FIELDS.filter((f) => !targetFields.includes(f));
    if (missing.length > 0) {
      throw new InvalidFieldMappingError(`missing required target field(s): ${missing.join(", ")}`);
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(importJobs)
        .set({ fieldMapping: input.fieldMapping, status: "mapped", updatedBy: actorId })
        .where(eq(importJobs.id, importJobId))
        .returning();
      return updated!;
    });
  }

  async validate(tenantId: string, actorId: string, importJobId: string) {
    const job = await this.getJob(tenantId, importJobId);
    if (job.status !== "mapped") throw new ImportJobNotMappedError();

    const rows = await this.parseMappedRows(tenantId, job);

    const errors: { row: number; field?: string; message: string }[] = [];
    let validRows = 0;
    rows.forEach((row, i) => {
      const result = costCodeRowSchema.safeParse(row);
      if (result.success) {
        validRows++;
      } else {
        for (const issue of result.error.issues) {
          errors.push({ row: i + 1, field: issue.path.join("."), message: issue.message });
        }
      }
    });

    const report = { totalRows: rows.length, validRows, errors };

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(importJobs)
        .set({ validationReport: report, status: "validated", updatedBy: actorId })
        .where(eq(importJobs.id, importJobId))
        .returning();
      return updated!;
    });
  }

  async commit(tenantId: string, actorId: string, importJobId: string) {
    const job = await this.getJob(tenantId, importJobId);
    if (job.status === "committed") throw new ImportJobAlreadyCommittedError();
    if (job.status !== "validated") throw new ImportJobNotValidatedError();

    const rows = await this.parseMappedRows(tenantId, job);
    const errors: { row: number; message: string }[] = [];
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const result = costCodeRowSchema.safeParse(rows[i]);
      if (!result.success) {
        skipped++;
        errors.push({ row: i + 1, message: result.error.issues.map((iss) => iss.message).join("; ") });
        continue;
      }
      try {
        await this.costCodes.create(tenantId, actorId, job.projectId!, result.data);
        created++;
      } catch (err) {
        skipped++;
        const message = err instanceof DomainError ? err.message : "failed to create cost code";
        errors.push({ row: i + 1, message });
      }
    }

    const commitResult = { created, skipped, errors };

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(importJobs)
        .set({ commitResult, status: "committed", updatedBy: actorId })
        .where(eq(importJobs.id, importJobId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "import_job.committed.v1",
        dedupeKey: `import_job.committed.v1:${importJobId}`,
        actorId,
        payload: {
          companyId: tenantId,
          importJobId,
          entityType: job.entityType,
          projectId: job.projectId,
          created,
          skipped,
        },
      });

      return updated!;
    });
  }

  private async parseMappedRows(
    tenantId: string,
    job: { fileId: string; fieldMapping: unknown },
  ): Promise<Record<string, string>[]> {
    const buffer = await this.fileUpload.getFileBuffer(tenantId, job.fileId);
    const { records } = csvToRecords(buffer.toString("utf8"));
    const mapping = job.fieldMapping as Record<string, string>;

    return records.map((record) => {
      const mapped: Record<string, string> = {};
      for (const [targetField, sourceHeader] of Object.entries(mapping)) {
        const value = record[sourceHeader] ?? "";
        if (value !== "") mapped[targetField] = value;
      }
      return mapped;
    });
  }
}
