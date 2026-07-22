import { Inject, Injectable } from "@nestjs/common";
import type { ExportEntityType } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { exportJobs } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { FileUploadService } from "../../files";
import { ExportJobNotFoundError } from "../domain/errors";
import { ExportsQueue } from "./exports.queue";

// api.md §14: "GET /exports/{entity} — ... 202 job." The endpoint enqueues
// work and returns immediately; ExportRunnerService (run by ExportWorker)
// does the actual CSV generation.
@Injectable()
export class ExportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly queue: ExportsQueue,
    private readonly fileUpload: FileUploadService,
  ) {}

  async requestExport(tenantId: string, actorId: string, entityType: ExportEntityType) {
    const job = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(exportJobs)
        .values({ tenantId, entityType, status: "queued", createdBy: actorId })
        .returning();
      const created = row!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "export_job.requested.v1",
        dedupeKey: `export_job.requested.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, exportJobId: created.id, entityType },
      });

      return created;
    });

    await this.queue.enqueue({ tenantId, actorId, exportJobId: job.id, entityType });
    return job;
  }

  async getJob(tenantId: string, exportJobId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const job = await tx.query.exportJobs.findFirst({ where: eq(exportJobs.id, exportJobId) });
      if (!job) throw new ExportJobNotFoundError();
      return job;
    });
  }

  async getDownloadUrl(tenantId: string, exportJobId: string): Promise<string> {
    const job = await this.getJob(tenantId, exportJobId);
    if (job.status !== "completed" || !job.fileId) {
      throw new Error(`export job ${exportJobId} is not ready for download (status: ${job.status})`);
    }
    return this.fileUpload.getDownloadUrl(tenantId, job.fileId);
  }
}
