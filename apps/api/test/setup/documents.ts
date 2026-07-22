import type { Database } from "../../src/infrastructure/db/client";
import { DocumentVersionsService } from "../../src/modules/documents/application/document-versions.service";
import { DocumentsService } from "../../src/modules/documents/application/documents.service";
import { DrawingSetsService } from "../../src/modules/documents/application/drawing-sets.service";
import { FoldersService } from "../../src/modules/documents/application/folders.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { FileUploadService } from "../../src/modules/files/application/file-upload.service";

export function buildTestDocumentServices(db: Database, fileUploadService: FileUploadService) {
  const outbox = new OutboxService();
  const documentsService = new DocumentsService(db, outbox);
  return {
    foldersService: new FoldersService(db, outbox),
    documentsService,
    versionsService: new DocumentVersionsService(db, outbox, fileUploadService, documentsService),
    drawingSetsService: new DrawingSetsService(db, outbox),
  };
}
