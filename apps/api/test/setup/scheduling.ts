import type Redis from "ioredis";
import { createQueueConnection } from "../../src/infrastructure/queue/connection";
import { createRedisClient } from "../../src/infrastructure/redis/client";
import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { ActivitiesService } from "../../src/modules/scheduling/application/activities.service";
import { DependenciesService } from "../../src/modules/scheduling/application/dependencies.service";
import { ScheduleRecalcQueue } from "../../src/modules/scheduling/application/recalculate.queue";
import { RecalculateService } from "../../src/modules/scheduling/application/recalculate.service";
import { SchedulesService } from "../../src/modules/scheduling/application/schedules.service";

export function buildTestSchedulingServices(db: Database): {
  schedulesService: SchedulesService;
  activitiesService: ActivitiesService;
  dependenciesService: DependenciesService;
  recalculateService: RecalculateService;
  queueConnection: Redis;
  cacheRedis: Redis;
} {
  const outbox = new OutboxService();
  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(cacheRedis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);
  const schedulesService = new SchedulesService(db, outbox, permissions, externalShares);
  const activitiesService = new ActivitiesService(db, outbox, schedulesService);
  const dependenciesService = new DependenciesService(db, outbox, schedulesService);
  const queueConnection = createQueueConnection({
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  });
  const queue = new ScheduleRecalcQueue(queueConnection);
  const recalculateService = new RecalculateService(db, outbox, schedulesService, queue);

  return { schedulesService, activitiesService, dependenciesService, recalculateService, queueConnection, cacheRedis };
}
