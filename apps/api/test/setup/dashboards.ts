import type { Database } from "../../src/infrastructure/db/client";
import type { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import type { OpportunitiesService } from "../../src/modules/crm/application/opportunities.service";
import { DashboardProjectionsWriterService } from "../../src/modules/dashboards/application/dashboard-projections-writer.service";
import { DashboardsService } from "../../src/modules/dashboards/application/dashboards.service";
import { ExecutiveBriefingService } from "../../src/modules/dashboards/application/executive-briefing.service";
import { WhatIfSimulationService } from "../../src/modules/dashboards/application/what-if-simulation.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { CashflowForecastService } from "../../src/modules/finance-alerts/application/cashflow-forecast.service";
import type { FinanceAlertsQueryService } from "../../src/modules/finance-alerts/application/finance-alerts-query.service";
import type { DelayImpactService } from "../../src/modules/scheduling/application/delay-impact.service";
import type { PredictiveScheduleRiskService } from "../../src/modules/scheduling/application/predictive-schedule-risk.service";
import type { ResourceAssignmentsService } from "../../src/modules/scheduling/application/resource-assignments.service";
import type { SchedulesService } from "../../src/modules/scheduling/application/schedules.service";

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

export function buildTestExecutiveBriefingService(
  db: Database,
  opportunitiesService: OpportunitiesService,
  financeAlertsQueryService: FinanceAlertsQueryService,
  predictiveScheduleRiskService: PredictiveScheduleRiskService,
  schedulesService: SchedulesService,
  cashflowForecastService: CashflowForecastService,
  aiGatewayService: AiGatewayService,
): ExecutiveBriefingService {
  return new ExecutiveBriefingService(
    db,
    new OutboxService(),
    opportunitiesService,
    financeAlertsQueryService,
    predictiveScheduleRiskService,
    schedulesService,
    cashflowForecastService,
    aiGatewayService,
  );
}
