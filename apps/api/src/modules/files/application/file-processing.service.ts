import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { files, jobRuns } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events/application/outbox.service";
import type { VirusScanner } from "../domain/virus-scanner";
import { VIRUS_SCANNER } from "../domain/virus-scanner";
import { StorageService } from "./storage.service";
import { ThumbnailService } from "./thumbnail.service";
import type { FileProcessingJobData } from "./file-processing.queue";

/**
 * The actual scan/thumbnail/status-update logic (architecture.md §13),
 * separated from BullMQ wiring (infrastructure/file-processing.worker.ts)
 * the same way RelayService is separated from RelayWorker — this class is
 * unit-testable without a running BullMQ Worker.
 */
@Injectable()
export class FileProcessingService {
  private readonly logger = new Logger(FileProcessingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
    private readonly thumbnails: ThumbnailService,
    private readonly outbox: OutboxService,
  ) {}

  async process({ fileId, tenantId }: FileProcessingJobData): Promise<void> {
    const startedAt = Date.now();
    const [jobRun] = await this.db
      .insert(jobRuns)
      .values({ tenantId, queue: "file-processing", status: "running" })
      .returning();
    const jobRunId = jobRun!.id;

    try {
      await withTenant(this.db, tenantId, async (tx) => {
        await tx.update(files).set({ status: "scanning" }).where(eq(files.id, fileId));
      });

      const file = await withTenant(this.db, tenantId, (tx) =>
        tx.query.files.findFirst({ where: eq(files.id, fileId) }),
      );
      if (!file) throw new Error(`file ${fileId} not found`);

      const buffer = await this.storage.getObjectBuffer(file.objectKey);
      const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
      const scanResult = await this.scanner.scan(buffer);

      if (!scanResult.clean) {
        await this.finish(tenantId, fileId, {
          status: "infected",
          checksumSha256,
          scanResult,
        });
        this.logger.warn(`file ${fileId} infected: ${scanResult.signature}`);
      } else {
        let thumbnailKey: string | null = null;
        if (this.thumbnails.supports(file.contentType)) {
          const thumbnail = await this.thumbnails.generate(buffer);
          thumbnailKey = this.storage.thumbnailKey(tenantId, fileId);
          await this.storage.putObjectBuffer(thumbnailKey, thumbnail.buffer, thumbnail.contentType);
        }
        await this.finish(tenantId, fileId, {
          status: "clean",
          checksumSha256,
          thumbnailKey,
        });
      }

      await this.db
        .update(jobRuns)
        .set({ status: "completed", attempts: 1, durationMs: Date.now() - startedAt, completedAt: new Date() })
        .where(eq(jobRuns.id, jobRunId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`file processing failed for ${fileId}: ${message}`);
      try {
        await this.finish(tenantId, fileId, { status: "scan_failed" });
      } catch (finishErr) {
        this.logger.error(`failed to record scan_failed status for ${fileId}: ${String(finishErr)}`);
      }
      await this.db
        .update(jobRuns)
        .set({
          status: "failed",
          attempts: 1,
          error: message,
          durationMs: Date.now() - startedAt,
          completedAt: new Date(),
        })
        .where(eq(jobRuns.id, jobRunId));
      throw err;
    }
  }

  private async finish(
    tenantId: string,
    fileId: string,
    update: {
      status: "clean" | "infected" | "scan_failed";
      checksumSha256?: string;
      thumbnailKey?: string | null;
      scanResult?: unknown;
    },
  ): Promise<void> {
    const signature =
      update.scanResult && typeof update.scanResult === "object" && "signature" in update.scanResult
        ? ((update.scanResult as { signature?: string }).signature ?? undefined)
        : undefined;

    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(files)
        .set({
          status: update.status,
          ...(update.checksumSha256 !== undefined && { checksumSha256: update.checksumSha256 }),
          ...(update.thumbnailKey !== undefined && { thumbnailKey: update.thumbnailKey }),
          ...(update.scanResult !== undefined && { scanResult: update.scanResult }),
        })
        .where(eq(files.id, fileId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "file.scan_completed.v1",
        dedupeKey: `file.scan_completed.v1:${fileId}`,
        actorId: null,
        actorType: "system",
        payload: {
          companyId: tenantId,
          fileId,
          status: update.status,
          ...(signature !== undefined && { signature }),
        },
      });
    });
  }
}
