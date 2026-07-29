import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createWarrantySchema, listWarrantiesQuerySchema, updateWarrantySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { WarrantiesService } from "../application/warranties.service";

// api.md §18 (FR-CLOSE-4).
@Controller()
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}

  @Get("projects/:id/warranties")
  @RequirePermission("closeout.warranty.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listWarrantiesQuerySchema)) query: z.infer<typeof listWarrantiesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.warranties.list(req.auth!.tenantId, projectId, query);
  }

  @Post("projects/:id/warranties")
  @RequirePermission("closeout.warranty.create")
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createWarrantySchema)) body: z.infer<typeof createWarrantySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.warranties.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Patch("warranties/:id")
  @RequirePermission("closeout.warranty.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWarrantySchema)) body: z.infer<typeof updateWarrantySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.warranties.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
