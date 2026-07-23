import { Injectable } from "@nestjs/common";
import type { FileScanCompletedV1, OutboxEnvelope } from "@constructionos/schemas";
import { PhotosService } from "../../photos";
import { PhotoAiService } from "./photo-ai.service";

// file.scan_completed.v1 is file-generic (fires for every uploaded file —
// documents, drawing sheets, photos, anything through the Files pipeline),
// not photo-specific, so this writer has to ask PhotosService whether the
// scanned file happens to be a photo at all — unlike RAG's writer, which
// trusts its event payloads to already carry the right entity id directly.
@Injectable()
export class PhotoAiWriterService {
  constructor(
    private readonly photos: PhotosService,
    private readonly photoAi: PhotoAiService,
  ) {}

  async handleEnvelope(envelope: OutboxEnvelope): Promise<void> {
    if (envelope.eventType !== "file.scan_completed.v1") return;

    const payload = envelope.payload as FileScanCompletedV1;
    if (payload.status !== "clean") return; // infected/scan_failed — nothing to tag

    const photo = await this.photos.findByFileId(envelope.tenantId, payload.fileId);
    if (!photo) return; // this file isn't a photo (a document, drawing sheet, etc.)

    await this.photoAi.tagPhoto(envelope.tenantId, photo.id, photo.projectId, payload.fileId);
  }
}
