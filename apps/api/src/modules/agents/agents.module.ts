import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createQueueConnection, QUEUE_CONNECTION } from "../../infrastructure/queue/connection";
import { createRedisClient, REDIS_CLIENT } from "../../infrastructure/redis/client";
import { EventsModule } from "../events";
// api.md §15.2: the Procurement Agent's daily tick composes
// ProcurementNeedsService.draftFromNeeds + PurchaseOrderLifecycleService.
// submit — Procurement doesn't import Agents anywhere, so this doesn't
// create a cycle.
import { ProcurementModule } from "../procurement";
// api.md §15.3: the Billing Agent's monthly tick composes
// BudgetService.getByProject + SchedulesService.getActiveSchedule +
// PaymentApplicationsService.create/submit — none of Budgets/Scheduling/
// Finance import Agents (Finance imports Budgets/Procurement/
// Subcontractors/Crm/Documents/Files only), so this doesn't create a
// cycle either.
import { BudgetsModule } from "../budgets";
import { FinanceModule } from "../finance";
// Deep imports, not the "../rbac" barrel — same cycle-avoidance precedent
// documented in auth/application/scim-groups.service.ts.
import { PermissionCacheService } from "../rbac/infrastructure/permission-cache.service";
import { RbacService } from "../rbac/application/rbac.service";
import { SchedulingModule } from "../scheduling";
import { AgentIdentitiesController } from "./api/agent-identities.controller";
import { AgentIdentitiesService } from "./application/agent-identities.service";
import { BillingAgentRunnerService } from "./application/billing-agent-runner.service";
import { ProcurementAgentRunnerService } from "./application/procurement-agent-runner.service";
import { BillingAgentWorker } from "./infrastructure/billing-agent.worker";
import { ProcurementAgentWorker } from "./infrastructure/procurement-agent.worker";

const env = loadEnv();

@Module({
  imports: [EventsModule, ProcurementModule, BudgetsModule, SchedulingModule, FinanceModule],
  controllers: [AgentIdentitiesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient(env) },
    { provide: QUEUE_CONNECTION, useFactory: () => createQueueConnection(env) },
    PermissionCacheService,
    RbacService,
    AgentIdentitiesService,
    ProcurementAgentRunnerService,
    ProcurementAgentWorker,
    BillingAgentRunnerService,
    BillingAgentWorker,
  ],
  exports: [AgentIdentitiesService],
})
export class AgentsModule {}
