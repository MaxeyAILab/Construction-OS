import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createSubcontractorSchema, listSubcontractorsQuerySchema, updateSubcontractorSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SubcontractorsService } from "../application/subcontractors.service";

// api.md has no dedicated Subcontractor API section (same gap as M12
// Safety) — this route shape follows the module.resource convention every
// other module's own api.md bullet establishes.
@Controller("subcontractors")
export class SubcontractorsController {
  constructor(private readonly subcontractors: SubcontractorsService) {}

  @Get()
  @RequirePermission("subcontractor.subcontractor.read")
  list(
    @Query(new ZodValidationPipe(listSubcontractorsQuerySchema)) query: z.infer<typeof listSubcontractorsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.subcontractors.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("subcontractor.subcontractor.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createSubcontractorSchema)) body: z.infer<typeof createSubcontractorSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.subcontractors.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("subcontractor.subcontractor.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.subcontractors.getById(req.auth!.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission("subcontractor.subcontractor.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSubcontractorSchema)) body: z.infer<typeof updateSubcontractorSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.subcontractors.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
