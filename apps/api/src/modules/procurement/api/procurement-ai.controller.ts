import { Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { listProcurementRecommendationsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ProcurementNeedsService } from "../application/procurement-needs.service";

@Controller()
export class ProcurementAiController {
  constructor(private readonly needs: ProcurementNeedsService) {}

  // api.md §11: "GET /procurement/ai/recommendations | Buy-timing/lead-
  // time risk feed per project (FR-PROC-5)." "+AI" reuses the base
  // procurement.po.read permission rather than a separate AI-specific key
  // — same convention as daily-reports.controller.ts's ai-summary
  // endpoint.
  @Get("procurement/ai/recommendations")
  @RequirePermission("procurement.po.read")
  async recommendations(
    @Query(new ZodValidationPipe(listProcurementRecommendationsQuerySchema))
    query: z.infer<typeof listProcurementRecommendationsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const needs = await this.needs.computeNeeds(req.auth!.tenantId, req.auth!.sub, query.projectId);
    return { needs };
  }

  // api.md §11: "POST /projects/{id}/purchase-orders:draft-from-needs | AI
  // PO drafting from budget+schedule (FR-PROC-6) -> drafts, never sent
  // without human approval." "::" escapes find-my-way's mid-segment ':'
  // parameter start into a literal colon — same precedent as
  // estimating.controller.ts's "lines::batch".
  @Post("projects/:id/purchase-orders::draft-from-needs")
  @RequirePermission("procurement.po.create")
  draftFromNeeds(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.needs.draftFromNeeds(req.auth!.tenantId, req.auth!.sub, id);
  }
}
