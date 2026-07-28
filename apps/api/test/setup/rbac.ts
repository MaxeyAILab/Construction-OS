import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { CompanySettingsService } from "../../src/modules/auth/application/company-settings.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { PermissionChangeRequestsService } from "../../src/modules/rbac/application/permission-change-requests.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { RbacService } from "../../src/modules/rbac/application/rbac.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestRbacServices(db: Database): {
  rbacService: RbacService;
  permissionResolver: PermissionResolverService;
  permissionChangeRequestsService: PermissionChangeRequestsService;
  companySettingsService: CompanySettingsService;
  redis: RedisClient;
} {
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(redis);
  const outbox = new OutboxService();
  const rbacService = new RbacService(db, cache, outbox);
  const permissionResolver = new PermissionResolverService(db, cache);
  const companySettingsService = new CompanySettingsService(db, outbox);

  return {
    rbacService,
    permissionResolver,
    permissionChangeRequestsService: new PermissionChangeRequestsService(
      db,
      outbox,
      companySettingsService,
      permissionResolver,
      rbacService,
    ),
    companySettingsService,
    redis,
  };
}
