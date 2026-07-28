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
// Deep imports, not the "../rbac" barrel — same cycle-avoidance precedent
// documented in auth/application/scim-groups.service.ts.
import { PermissionCacheService } from "../rbac/infrastructure/permission-cache.service";
import { RbacService } from "../rbac/application/rbac.service";
import { AgentIdentitiesController } from "./api/agent-identities.controller";
import { AgentIdentitiesService } from "./application/agent-identities.service";
import { ProcurementAgentRunnerService } from "./application/procurement-agent-runner.service";
import { ProcurementAgentWorker } from "./infrastructure/procurement-agent.worker";

const env = loadEnv();

@Module({
  imports: [EventsModule, ProcurementModule],
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
  ],
  exports: [AgentIdentitiesService],
})
export class AgentsModule {}
