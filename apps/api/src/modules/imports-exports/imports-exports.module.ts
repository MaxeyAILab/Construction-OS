import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createQueueConnection, QUEUE_CONNECTION } from "../../infrastructure/queue/connection";
import { EventsModule } from "../events";
import { FilesModule } from "../files";
import { ProjectsModule } from "../projects";
import { ImportsExportsController } from "./api/imports-exports.controller";
import { ExportRunnerService } from "./application/export-runner.service";
import { ExportsQueue } from "./application/exports.queue";
import { ExportsService } from "./application/exports.service";
import { ImportsService } from "./application/imports.service";
import { ExportWorker } from "./infrastructure/export.worker";

const env = loadEnv();

@Module({
  imports: [EventsModule, FilesModule, ProjectsModule],
  controllers: [ImportsExportsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: QUEUE_CONNECTION, useFactory: () => createQueueConnection(env) },
    ExportsQueue,
    ExportRunnerService,
    ExportWorker,
    ExportsService,
    ImportsService,
  ],
})
export class ImportsExportsModule {}
