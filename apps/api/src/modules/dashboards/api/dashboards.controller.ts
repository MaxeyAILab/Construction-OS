import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { simulateWhatIfInputSchema } from "@constructionos/schemas";
import type { z } from "zod";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import { DashboardsService } from "../application/dashboards.service";
import { WhatIfSimulationService } from "../application/what-if-simulation.service";

// api.md §14 (M16). GET /dashboards/company and GET /dashboards/projects/{id}
// — the /reports/* rows this comment used to flag as deferred now live in
// ReportsController (Phase 3's "Portfolio analytics & custom report
// builder"); /exports and /imports were built in the Imports/Exports row.
@Controller("dashboards")
export class DashboardsController {
  constructor(
    private readonly dashboards: DashboardsService,
    private readonly whatIf: WhatIfSimulationService,
  ) {}

  @Get("company")
  @RequirePermission("dashboard.company.read")
  getCompany(@Req() req: AuthenticatedRequest) {
    return this.dashboards.getCompany(req.auth!.tenantId);
  }

  @Get("projects/:id")
  @RequirePermission("dashboard.project.read")
  getProject(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.dashboards.getProject(req.auth!.tenantId, projectId);
  }

  // api.md §14: "POST /dashboards/company/what-if" — reuses the base
  // dashboard.company.read permission (same "+AI reuses an existing
  // resource's permission" convention as every other AI endpoint this
  // session) since this is a pure simulation, nothing is written back.
  @Post("company/what-if")
  @RequirePermission("dashboard.company.read")
  @HttpCode(HttpStatus.OK)
  simulateWhatIf(
    @Body(new ZodValidationPipe(simulateWhatIfInputSchema)) body: z.infer<typeof simulateWhatIfInputSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.whatIf.simulate(req.auth!.tenantId, req.auth!.sub, body);
  }
}
