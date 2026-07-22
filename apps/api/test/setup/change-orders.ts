import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { ChangeOrderLifecycleService } from "../../src/modules/change-orders/application/change-order-lifecycle.service";
import { ChangeOrdersService } from "../../src/modules/change-orders/application/change-orders.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestChangeOrderServices(db: Database): {
  changeOrdersService: ChangeOrdersService;
  lifecycleService: ChangeOrderLifecycleService;
  redis: RedisClient;
} {
  const outbox = new OutboxService();
  const changeOrdersService = new ChangeOrdersService(db, outbox);
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(redis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);

  return {
    changeOrdersService,
    lifecycleService: new ChangeOrderLifecycleService(db, outbox, changeOrdersService, permissions, externalShares),
    redis,
  };
}
