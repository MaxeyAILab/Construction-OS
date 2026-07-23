import { Inject, Injectable, Logger } from "@nestjs/common";
import { photoAiDefectSchema, photoAiTagSchema } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { photos } from "../../../infrastructure/db/schema";
import { AiGatewayService, type AiImageInput, type AiToolSpec } from "../../ai";
import { OutboxService } from "../../events";
import { FileUploadService } from "../../files";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;
const TOOL_NAME = "emit_photo_tags";

const SUPPORTED_IMAGE_TYPES = new Set<AiImageInput["mediaType"]>(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const emitPhotoTagsInputSchema = z.object({
  tags: z.array(photoAiTagSchema).max(10),
  defects: z.array(photoAiDefectSchema).max(10),
});

const SYSTEM_PROMPT =
  "You are a construction-site photo analyst. Identify the trade, building element, and material visibly present in the photo, and flag any visible defects or quality issues. Report only what is visibly evident — never guess at what you cannot see. If nothing is identifiable, return empty arrays.";

// ai-spec.md §7.8 (Photo AI, FR-FIELD-7): "auto-tagging (trade, element,
// material) ... defect/quality flagging." A single forced-tool call, not
// the agentic tool-calling loop (ToolRunnerService) — there's no free
// choice to make here, always exactly one structured-extraction call
// against the photo's own bytes (ai-spec §10.2: structured output, never
// parsed from prose).
//
// "Progress inference against schedule activities" and "safety-hazard
// detection (feeds 7.9)" — ai-spec §7.8's other two capabilities — are
// deliberately not implemented: progress inference has no mechanical way
// to associate an arbitrary (often entity-less) photo with a specific
// schedule activity without new linking UX this pass doesn't build, and
// Safety AI (§7.9) has no schema/module in this codebase yet to feed.
// Flagged follow-ups, not silently dropped.
@Injectable()
export class PhotoAiService {
  private readonly logger = new Logger(PhotoAiService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
    private readonly fileUpload: FileUploadService,
    private readonly outbox: OutboxService,
  ) {}

  // Autonomy per ai-spec §7.8: tagging auto-applies (reversible/
  // correctable — this just overwrites photos.ai_tags on every call, same
  // "recompute-and-replace" idempotency as RagIndexingService); defects
  // stay a draft surfaced in that same column, never auto-creating a task.
  async tagPhoto(tenantId: string, photoId: string, projectId: string, fileId: string): Promise<void> {
    const file = await this.fileUpload.getFile(tenantId, fileId);
    if (!SUPPORTED_IMAGE_TYPES.has(file.contentType as AiImageInput["mediaType"])) {
      this.logger.log(`photo ${photoId}: content-type ${file.contentType} isn't an image Photo AI can analyze, skipping`);
      return;
    }

    const buffer = await this.fileUpload.getFileBuffer(tenantId, fileId);

    const toolSpec: AiToolSpec = {
      name: TOOL_NAME,
      description: "Report the tags and defects visible in the photo.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod-to-json-schema's own ZodSchema type is a distinct nominal type from this codebase's "zod" import; see tool-runner.service.ts's identical bridge comment.
      inputSchema: zodToJsonSchema(emitPhotoTagsInputSchema as any, { target: "jsonSchema7", $refStrategy: "none" }) as Record<
        string,
        unknown
      >,
    };

    const result = await this.aiGateway.run(tenantId, null, {
      purpose: "photo_ai.tag",
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: "Analyze this construction site photo.",
          images: [{ mediaType: file.contentType as AiImageInput["mediaType"], base64Data: buffer.toString("base64") }],
        },
      ],
      tools: [toolSpec],
      forceToolName: TOOL_NAME,
      maxTokens: MAX_TOKENS,
    });

    const call = result.toolCalls[0];
    if (!call) throw new Error(`Photo AI: model did not call ${TOOL_NAME} for photo ${photoId}`);
    const parsed = emitPhotoTagsInputSchema.parse(call.input);

    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(photos)
        .set({ aiTags: { ...parsed, model: result.model, taggedAt: new Date().toISOString() } })
        .where(eq(photos.id, photoId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "photo.tagged.v1",
        dedupeKey: `photo.tagged.v1:${photoId}`,
        actorId: null,
        actorType: "ai",
        payload: { companyId: tenantId, projectId, photoId, aiRunId: result.aiRunId },
      });
    });
  }
}
