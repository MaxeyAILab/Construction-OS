import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createRedisClient, REDIS_CLIENT } from "../../infrastructure/redis/client";
import { RbacController } from "./api/rbac.controller";
import { PermissionGuard } from "./api/permission.guard";
import { PermissionResolverService } from "./application/permission-resolver.service";
import { RbacService } from "./application/rbac.service";
import { PermissionCacheService } from "./infrastructure/permission-cache.service";

const env = loadEnv();

@Module({
  controllers: [RbacController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient(env) },
    PermissionCacheService,
    PermissionResolverService,
    RbacService,
    PermissionGuard,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionResolverService, PermissionGuard],
})
export class RbacModule {}
