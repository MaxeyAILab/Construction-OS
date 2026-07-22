import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createRfiSchema, listRfisQuerySchema, updateRfiSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { RfisService } from "../application/rfis.service";

@Controller()
export class RfisController {
  constructor(private readonly rfis: RfisService) {}

  @Get("projects/:id/rfis")
  @RequirePermission("docs.rfi.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listRfisQuerySchema)) query: z.infer<typeof listRfisQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rfis.list(req.auth!.tenantId, projectId, query);
  }

  @Post("projects/:id/rfis")
  @RequirePermission("docs.rfi.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createRfiSchema)) body: z.infer<typeof createRfiSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rfis.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  // Gap-fill: api.md §8 groups GET/POST/PATCH under one row without an
  // itemized detail-GET path; a single-RFI fetch is needed to view the
  // full question/answer/status before patching it.
  @Get("rfis/:id")
  @RequirePermission("docs.rfi.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.rfis.getById(req.auth!.tenantId, id);
  }

  @Patch("rfis/:id")
  @RequirePermission("docs.rfi.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateRfiSchema)) body: z.infer<typeof updateRfiSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rfis.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
