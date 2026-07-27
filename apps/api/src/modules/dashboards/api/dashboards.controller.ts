import { Controller, Get, Param, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { DashboardsService } from "../application/dashboards.service";

// api.md §14 (M16). GET /dashboards/company and GET /dashboards/projects/{id}
// — the /reports/* rows this comment used to flag as deferred now live in
// ReportsController (Phase 3's "Portfolio analytics & custom report
// builder"); /exports and /imports were built in the Imports/Exports row.
@Controller("dashboards")
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

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
}
