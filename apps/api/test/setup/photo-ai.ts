import type { Database } from "../../src/infrastructure/db/client";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../../src/modules/ai/domain/ai-provider";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { FileUploadService } from "../../src/modules/files/application/file-upload.service";
import type { PhotosService } from "../../src/modules/photos/application/photos.service";
import { PhotoAiWriterService } from "../../src/modules/photo-ai/application/photo-ai-writer.service";
import { PhotoAiService } from "../../src/modules/photo-ai/application/photo-ai.service";

// Same "real double, not a network client" role as FakeAiProvider — this
// one only supports the one call shape PhotoAiService actually makes
// (forced tool choice), returning a fixed, deterministic tag/defect set
// regardless of the image bytes (there's no real vision model to exercise
// in this sandbox, mirroring the AI Gateway/RAG rows' own precedent).
export class FakePhotoTaggingProvider implements AiProvider {
  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    if (!request.forceToolName) throw new Error("FakePhotoTaggingProvider only supports forced-tool-choice calls");
    return {
      content: null,
      toolCalls: [
        {
          id: "call-tag",
          name: request.forceToolName,
          input: {
            tags: [{ label: "drywall", category: "material", confidence: 0.92 }],
            defects: [{ description: "visible crack near the corner", severity: "medium", confidence: 0.81 }],
          },
        },
      ],
      inputTokens: 120,
      outputTokens: 40,
    };
  }
}

export function buildTestPhotoAiServices(
  db: Database,
  fileUploadService: FileUploadService,
  photosService: PhotosService,
): { photoAiService: PhotoAiService; photoAiWriterService: PhotoAiWriterService } {
  const outbox = new OutboxService();
  const aiGatewayService = new AiGatewayService(db, new FakePhotoTaggingProvider());
  const photoAiService = new PhotoAiService(db, aiGatewayService, fileUploadService, outbox);
  const photoAiWriterService = new PhotoAiWriterService(photosService, photoAiService);
  return { photoAiService, photoAiWriterService };
}
