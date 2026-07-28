import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { ComplianceAlertsController } from "./api/compliance-alerts.controller";
import { ComplianceAlertsQueryService } from "./application/compliance-alerts-query.service";
import { ComplianceAlertsService } from "./application/compliance-alerts.service";

const env = loadEnv();

// api.md §15.4 "Compliance Agent" (FR-SUB-2, FR-SAFE-2). No NATS consumer
// worker here, unlike FinanceAlertsModule — ComplianceAlertsService is
// called directly by ComplianceAgentRunnerService (AgentsModule) inside
// its own tick, not reacted to from an event stream.
@Module({
  imports: [EventsModule],
  controllers: [ComplianceAlertsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    ComplianceAlertsQueryService,
    ComplianceAlertsService,
  ],
  exports: [ComplianceAlertsQueryService, ComplianceAlertsService],
})
export class ComplianceAlertsModule {}
