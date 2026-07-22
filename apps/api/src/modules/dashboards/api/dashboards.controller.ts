import { Controller, Get, Param, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { DashboardsService } from "../application/dashboards.service";

// api.md §14 (M16). GET /dashboards/company and GET /dashboards/projects/{id}
// are the two rows this pass actually implements — /reports/definitions,
// /reports/definitions/{id}/run, /reports/runs/{id}, /exports/{entity}, and
// /imports (same api.md section) are flagged out of scope: the roadmap's
// own "Imports (CSV guided) + full export" row is a later, separate line
// item, and a scheduled-report/PDF-XLSX-artifact job pipeline is
// substantial new infrastructure this row's own success metric (dashboard
// p95 < 3s, NFR-4) doesn't require.
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
