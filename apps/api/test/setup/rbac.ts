import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { RbacService } from "../../src/modules/rbac/application/rbac.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestRbacServices(db: Database): {
  rbacService: RbacService;
  permissionResolver: PermissionResolverService;
  redis: RedisClient;
} {
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(redis);

  return {
    rbacService: new RbacService(db, cache),
    permissionResolver: new PermissionResolverService(db, cache),
    redis,
  };
}
