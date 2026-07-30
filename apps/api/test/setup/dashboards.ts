import type { Database } from "../../src/infrastructure/db/client";
import type { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import type { OpportunitiesService } from "../../src/modules/crm/application/opportunities.service";
import { DashboardProjectionsWriterService } from "../../src/modules/dashboards/application/dashboard-projections-writer.service";
import { DashboardsService } from "../../src/modules/dashboards/application/dashboards.service";
import { WhatIfSimulationService } from "../../src/modules/dashboards/application/what-if-simulation.service";
import type { DelayImpactService } from "../../src/modules/scheduling/application/delay-impact.service";
import type { ResourceAssignmentsService } from "../../src/modules/scheduling/application/resource-assignments.service";

export function buildTestDashboardsServices(db: Database) {
  return {
    dashboardsService: new DashboardsService(db),
    projectionsWriterService: new DashboardProjectionsWriterService(db),
  };
}

export function buildTestWhatIfSimulationService(
  opportunitiesService: OpportunitiesService,
  resourceAssignmentsService: ResourceAssignmentsService,
  delayImpactService: DelayImpactService,
  aiGatewayService: AiGatewayService,
): WhatIfSimulationService {
  return new WhatIfSimulationService(opportunitiesService, resourceAssignmentsService, delayImpactService, aiGatewayService);
}
