import type Redis from "ioredis";
import { createRedisClient } from "../../src/infrastructure/redis/client";
import type { Database } from "../../src/infrastructure/db/client";
import { PortalMessagesService } from "../../src/modules/client-portal/application/portal-messages.service";
import { SelectionsService } from "../../src/modules/client-portal/application/selections.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestClientPortalServices(db: Database): {
  selectionsService: SelectionsService;
  portalMessagesService: PortalMessagesService;
  cacheRedis: Redis;
} {
  const outbox = new OutboxService();
  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(cacheRedis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);

  return {
    selectionsService: new SelectionsService(db, outbox, permissions, externalShares),
    portalMessagesService: new PortalMessagesService(db, outbox, permissions, externalShares),
    cacheRedis,
  };
}
