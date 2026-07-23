import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { FileUploadService } from "../../src/modules/files/application/file-upload.service";
import { PhotosService } from "../../src/modules/photos/application/photos.service";

export function buildTestPhotosServices(db: Database, fileUploadService: FileUploadService): { photosService: PhotosService } {
  return { photosService: new PhotosService(db, new OutboxService(), fileUploadService) };
}
