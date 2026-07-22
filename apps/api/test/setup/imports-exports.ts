import type Redis from "ioredis";
import { createQueueConnection } from "../../src/infrastructure/queue/connection";
import type { Database } from "../../src/infrastructure/db/client";
import { CostCodesService } from "../../src/modules/projects/application/cost-codes.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { ExportRunnerService } from "../../src/modules/imports-exports/application/export-runner.service";
import { ExportsQueue } from "../../src/modules/imports-exports/application/exports.queue";
import { ExportsService } from "../../src/modules/imports-exports/application/exports.service";
import { ImportsService } from "../../src/modules/imports-exports/application/imports.service";
import { FakeStorageService, FakeVirusScanner } from "./files";
import { FileProcessingQueue } from "../../src/modules/files/application/file-processing.queue";
import { FileProcessingService } from "../../src/modules/files/application/file-processing.service";
import { FileUploadService } from "../../src/modules/files/application/file-upload.service";
import { ThumbnailService } from "../../src/modules/files/application/thumbnail.service";

export function buildTestImportsExportsServices(db: Database): {
  storage: FakeStorageService;
  fileUploadService: FileUploadService;
  fileProcessingService: FileProcessingService;
  exportsService: ExportsService;
  exportRunnerService: ExportRunnerService;
  importsService: ImportsService;
  costCodesService: CostCodesService;
  queueConnection: Redis;
} {
  const storage = new FakeStorageService();
  const outbox = new OutboxService();
  const queueConnection = createQueueConnection({
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  });
  const processingQueue = new FileProcessingQueue(queueConnection);
  const fileUploadService = new FileUploadService(db, storage, outbox, processingQueue);
  const fileProcessingService = new FileProcessingService(
    db,
    storage,
    new FakeVirusScanner(),
    new ThumbnailService(),
    outbox,
  );

  const exportsQueue = new ExportsQueue(queueConnection);
  const exportRunnerService = new ExportRunnerService(db, fileUploadService);
  const exportsService = new ExportsService(db, outbox, exportsQueue, fileUploadService);
  const costCodesService = new CostCodesService(db, outbox);
  const importsService = new ImportsService(db, outbox, fileUploadService, costCodesService);

  return {
    storage,
    fileUploadService,
    fileProcessingService,
    exportsService,
    exportRunnerService,
    importsService,
    costCodesService,
    queueConnection,
  };
}
