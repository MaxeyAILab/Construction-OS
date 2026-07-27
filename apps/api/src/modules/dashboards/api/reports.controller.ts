import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createReportDefinitionSchema, listReportDefinitionsQuerySchema, updateReportDefinitionSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ReportsService } from "../application/reports.service";

// api.md §14 (M16 Reports & Dashboards, FR-EXEC-2). Previously flagged out
// of scope in DashboardsController's own doc comment — this is that
// deferred row, built now under Phase 3's "Portfolio analytics & custom
// report builder." run/get-run reuse the read verb — same "materializing
// a read-only view as a document doesn't need its own write permission"
// precedent as Payment Applications' generate-pdf.
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("definitions")
  @RequirePermission("reports.definition.read")
  list(
    @Query(new ZodValidationPipe(listReportDefinitionsQuerySchema)) query: z.infer<typeof listReportDefinitionsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reports.list(req.auth!.tenantId, query);
  }

  @Post("definitions")
  @RequirePermission("reports.definition.create")
  create(
    @Body(new ZodValidationPipe(createReportDefinitionSchema)) body: z.infer<typeof createReportDefinitionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reports.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get("definitions/:id")
  @RequirePermission("reports.definition.read")
  getDefinition(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.reports.getDefinition(req.auth!.tenantId, id);
  }

  @Patch("definitions/:id")
  @RequirePermission("reports.definition.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateReportDefinitionSchema)) body: z.infer<typeof updateReportDefinitionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reports.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post("definitions/:id/run")
  @RequirePermission("reports.definition.read")
  @HttpCode(HttpStatus.ACCEPTED)
  requestRun(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.reports.requestRun(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Get("runs/:id")
  @RequirePermission("reports.definition.read")
  getRun(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.reports.getRun(req.auth!.tenantId, id);
  }
}
