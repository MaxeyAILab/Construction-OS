import { Controller, Get, Query, Req } from "@nestjs/common";
import { listAiRunsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { AiGatewayService } from "../application/ai-gateway.service";

// api.md §13: AI Assistant Layer routes. Only `GET /ai/runs` exists this
// pass — the conversational endpoints (/ai/conversations, /ai/search,
// /ai/actions/{id}/confirm, /ai/memories) belong to later Phase 1D rows
// (RAG pipeline, Project Assistant) that don't exist yet; this row is the
// gateway infrastructure + its audit surface only.
@Controller("ai")
export class AiController {
  constructor(private readonly aiGateway: AiGatewayService) {}

  @Get("runs")
  @RequirePermission("ai.run.read")
  listRuns(
    @Query(new ZodValidationPipe(listAiRunsQuerySchema))
    query: z.infer<typeof listAiRunsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiGateway.listRuns(req.auth!.tenantId, query);
  }
}
