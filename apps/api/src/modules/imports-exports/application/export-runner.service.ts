import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { exportJobs } from "../../../infrastructure/db/schema";
import { FileUploadService } from "../../files";
import { toCsv } from "../domain/csv";
import { exporters } from "../domain/exporters";
import type { ExportJobData } from "./exports.queue";

// The actual work behind ExportWorker's BullMQ consumer — split out the
// same way FileProcessingWorker/FileProcessingService are, so the BullMQ
// wiring itself stays thin.
@Injectable()
export class ExportRunnerService {
  private readonly logger = new Logger(ExportRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly fileUpload: FileUploadService,
  ) {}

  async run(data: ExportJobData): Promise<void> {
    const { tenantId, actorId, exportJobId, entityType } = data;

    await withTenant(this.db, tenantId, (tx) =>
      tx.update(exportJobs).set({ status: "running" }).where(eq(exportJobs.id, exportJobId)),
    );

    try {
      const { headers, rows } = await exporters[entityType](this.db, tenantId);
      const csv = toCsv(headers, rows);
      const { fileId } = await this.fileUpload.storeGeneratedFile(tenantId, actorId, {
        filename: `${entityType}.csv`,
        contentType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });

      await withTenant(this.db, tenantId, (tx) =>
        tx
          .update(exportJobs)
          .set({ status: "completed", fileId, rowCount: rows.length })
          .where(eq(exportJobs.id, exportJobId)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`export job ${exportJobId} (${entityType}) failed: ${message}`);
      await withTenant(this.db, tenantId, (tx) =>
        tx.update(exportJobs).set({ status: "failed", error: message }).where(eq(exportJobs.id, exportJobId)),
      );
      throw err;
    }
  }
}
