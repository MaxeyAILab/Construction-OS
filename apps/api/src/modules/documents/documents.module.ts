import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { FilesModule } from "../files";
import { RbacModule } from "../rbac";
import { DocumentsController } from "./api/documents.controller";
import { DocumentVersionsService } from "./application/document-versions.service";
import { DocumentsService } from "./application/documents.service";
import { DrawingSetsService } from "./application/drawing-sets.service";
import { FoldersService } from "./application/folders.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, FilesModule, RbacModule],
  controllers: [DocumentsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    FoldersService,
    DocumentsService,
    DocumentVersionsService,
    DrawingSetsService,
  ],
  // M6 Mobile Sync (roadmap.md "Field tasks/punch + drawing viewer
  // offline") reuses these for the working-set manifest's drawing set —
  // same "broaden an existing module's public surface" precedent as
  // TasksModule exporting TasksService for the same sync engine.
  exports: [DocumentsService, DocumentVersionsService, DrawingSetsService],
})
export class DocumentsModule {}
