import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createQueueConnection, QUEUE_CONNECTION } from "../../infrastructure/queue/connection";
import { EventsModule } from "../events";
import { VIRUS_SCANNER } from "./domain/virus-scanner";
import { FileProcessingQueue } from "./application/file-processing.queue";
import { FileProcessingService } from "./application/file-processing.service";
import { FileUploadService } from "./application/file-upload.service";
import { StorageService } from "./application/storage.service";
import { ThumbnailService } from "./application/thumbnail.service";
import { ClamAvScanner } from "./infrastructure/clamav-scanner";
import { CLAMD_SCANNER, createClamdScanner } from "./infrastructure/clamd-client";
import { FileProcessingWorker } from "./infrastructure/file-processing.worker";
import { createS3Client, S3_BUCKET, S3_CLIENT } from "./infrastructure/s3-client";

const env = loadEnv();

// No controller: api.md has no generic /files resource today — this is
// the Phase 1A infra row (roadmap.md), consumed via FileUploadService by
// whichever Phase 1B module (Documents' versions, Photos) exposes its own
// api.md-documented :initiate/:complete endpoint.
@Module({
  imports: [EventsModule],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: QUEUE_CONNECTION, useFactory: () => createQueueConnection(env) },
    { provide: S3_CLIENT, useFactory: () => createS3Client(env) },
    { provide: S3_BUCKET, useValue: env.S3_BUCKET },
    { provide: CLAMD_SCANNER, useFactory: () => createClamdScanner(env) },
    { provide: VIRUS_SCANNER, useClass: ClamAvScanner },
    StorageService,
    ThumbnailService,
    FileUploadService,
    FileProcessingQueue,
    FileProcessingService,
    FileProcessingWorker,
  ],
  exports: [FileUploadService],
})
export class FilesModule {}
