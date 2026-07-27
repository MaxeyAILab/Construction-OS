import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createSubmittalSchema, listSubmittalsQuerySchema, updateSubmittalSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SubmittalsService } from "../application/submittals.service";

@Controller()
export class SubmittalsController {
  constructor(private readonly submittals: SubmittalsService) {}

  @Get("projects/:id/submittals")
  @RequirePermission("docs.submittal.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listSubmittalsQuerySchema)) query: z.infer<typeof listSubmittalsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.submittals.list(req.auth!.tenantId, projectId, query);
  }

  @Post("projects/:id/submittals")
  @RequirePermission("docs.submittal.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createSubmittalSchema)) body: z.infer<typeof createSubmittalSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.submittals.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  // Gap-fill: api.md §8 groups GET/POST/PATCH under one row without an
  // itemized detail-GET path — same precedent as RfisController's own
  // single-item GET.
  @Get("submittals/:id")
  @RequirePermission("docs.submittal.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.submittals.getById(req.auth!.tenantId, id);
  }

  @Patch("submittals/:id")
  @RequirePermission("docs.submittal.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSubmittalSchema)) body: z.infer<typeof updateSubmittalSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.submittals.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
