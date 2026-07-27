import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { createSubcontractLineSchema, createSubcontractSchema, listSubcontractsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SubcontractsService } from "../application/subcontracts.service";

@Controller()
export class SubcontractsController {
  constructor(private readonly subcontracts: SubcontractsService) {}

  @Get("projects/:id/subcontracts")
  @RequirePermission("subcontractor.subcontract.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listSubcontractsQuerySchema)) query: z.infer<typeof listSubcontractsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.subcontracts.listForProject(req.auth!.tenantId, projectId, query);
  }

  // FR-SUB-2: eligibility-gated (see SubcontractsService.create's doc
  // comment) — throws a 422 if the subcontractor has an expired
  // compliance document on file.
  @Post("projects/:id/subcontracts")
  @RequirePermission("subcontractor.subcontract.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createSubcontractSchema)) body: z.infer<typeof createSubcontractSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.subcontracts.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("subcontracts/:id")
  @RequirePermission("subcontractor.subcontract.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.subcontracts.getById(req.auth!.tenantId, id);
  }

  @Post("subcontracts/:id/lines")
  @RequirePermission("subcontractor.subcontract.create")
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createSubcontractLineSchema)) body: z.infer<typeof createSubcontractLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.subcontracts.addLine(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post("subcontracts/:id/submit")
  @RequirePermission("subcontractor.subcontract.update")
  submit(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.subcontracts.submit(req.auth!.tenantId, req.auth!.sub, id);
  }

  // FR-SUB-3: "approval creates commitments (mirror of PO flow)".
  @Post("subcontracts/:id/approve")
  @RequirePermission("subcontractor.subcontract.approve")
  approve(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.subcontracts.approve(req.auth!.tenantId, req.auth!.sub, id);
  }

  // Gap-fill (see SubcontractsService.void's doc comment).
  @Post("subcontracts/:id/void")
  @RequirePermission("subcontractor.subcontract.update")
  void_(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.subcontracts.void(req.auth!.tenantId, req.auth!.sub, id);
  }
}
