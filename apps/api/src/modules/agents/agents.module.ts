import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createRedisClient, REDIS_CLIENT } from "../../infrastructure/redis/client";
import { EventsModule } from "../events";
// Deep imports, not the "../rbac" barrel — same cycle-avoidance precedent
// documented in auth/application/scim-groups.service.ts.
import { PermissionCacheService } from "../rbac/infrastructure/permission-cache.service";
import { RbacService } from "../rbac/application/rbac.service";
import { AgentIdentitiesController } from "./api/agent-identities.controller";
import { AgentIdentitiesService } from "./application/agent-identities.service";

const env = loadEnv();

@Module({
  imports: [EventsModule],
  controllers: [AgentIdentitiesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient(env) },
    PermissionCacheService,
    RbacService,
    AgentIdentitiesService,
  ],
  exports: [AgentIdentitiesService],
})
export class AgentsModule {}
