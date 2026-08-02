import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { createApprovalMatrixSchema, listApprovalMatricesQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ApprovalMatricesService } from "../application/approval-matrices.service";

// api.md §20 (M3, FR-DOC-9).
@Controller("admin/approval-matrices")
export class ApprovalMatricesController {
  constructor(private readonly matrices: ApprovalMatricesService) {}

  @Get()
  @RequirePermission("docs.approval_matrix.manage")
  list(
    @Query(new ZodValidationPipe(listApprovalMatricesQuerySchema))
    query: z.infer<typeof listApprovalMatricesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matrices.list(req.auth!.tenantId, query.entityType);
  }

  @Post()
  @RequirePermission("docs.approval_matrix.manage")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createApprovalMatrixSchema)) body: z.infer<typeof createApprovalMatrixSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.matrices.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("docs.approval_matrix.manage")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.matrices.getById(req.auth!.tenantId, id);
  }
}
