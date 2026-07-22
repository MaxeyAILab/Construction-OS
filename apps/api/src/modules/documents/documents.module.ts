import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { FilesModule } from "../files";
import { DocumentsController } from "./api/documents.controller";
import { DocumentVersionsService } from "./application/document-versions.service";
import { DocumentsService } from "./application/documents.service";
import { DrawingSetsService } from "./application/drawing-sets.service";
import { FoldersService } from "./application/folders.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, FilesModule],
  controllers: [DocumentsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    FoldersService,
    DocumentsService,
    DocumentVersionsService,
    DrawingSetsService,
  ],
})
export class DocumentsModule {}
