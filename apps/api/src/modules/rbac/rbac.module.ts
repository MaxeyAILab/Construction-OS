import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createRedisClient, REDIS_CLIENT } from "../../infrastructure/redis/client";
import { EventsModule } from "../events";
import { ExternalSharesController } from "./api/external-shares.controller";
import { RbacController } from "./api/rbac.controller";
import { PermissionGuard } from "./api/permission.guard";
import { ExternalSharesService } from "./application/external-shares.service";
import { PermissionResolverService } from "./application/permission-resolver.service";
import { RbacService } from "./application/rbac.service";
import { PermissionCacheService } from "./infrastructure/permission-cache.service";

const env = loadEnv();

@Module({
  imports: [EventsModule],
  controllers: [RbacController, ExternalSharesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient(env) },
    PermissionCacheService,
    PermissionResolverService,
    RbacService,
    ExternalSharesService,
    PermissionGuard,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionResolverService, ExternalSharesService, PermissionGuard],
})
export class RbacModule {}
