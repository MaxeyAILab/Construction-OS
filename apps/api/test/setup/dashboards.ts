import type { Database } from "../../src/infrastructure/db/client";
import { DashboardProjectionsWriterService } from "../../src/modules/dashboards/application/dashboard-projections-writer.service";
import { DashboardsService } from "../../src/modules/dashboards/application/dashboards.service";

export function buildTestDashboardsServices(db: Database) {
  return {
    dashboardsService: new DashboardsService(db),
    projectionsWriterService: new DashboardProjectionsWriterService(db),
  };
}
