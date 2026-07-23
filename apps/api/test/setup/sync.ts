import type Redis from "ioredis";
import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient } from "../../src/infrastructure/redis/client";
import { CostTransactionsService } from "../../src/modules/budgets/application/cost-transactions.service";
import { DailyReportsService } from "../../src/modules/daily-reports/application/daily-reports.service";
import { TimeEntriesService } from "../../src/modules/daily-reports/application/time-entries.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { SyncConflictsService } from "../../src/modules/sync/application/sync-conflicts.service";
import { SyncDeltaService } from "../../src/modules/sync/application/sync-delta.service";
import { SyncMutationsService } from "../../src/modules/sync/application/sync-mutations.service";
import { SyncWorkingSetService } from "../../src/modules/sync/application/sync-working-set.service";
import { TasksService } from "../../src/modules/tasks/application/tasks.service";

export function buildTestSyncServices(db: Database): {
  syncMutationsService: SyncMutationsService;
  syncDeltaService: SyncDeltaService;
  syncWorkingSetService: SyncWorkingSetService;
  syncConflictsService: SyncConflictsService;
  tasksService: TasksService;
  dailyReportsService: DailyReportsService;
  timeEntriesService: TimeEntriesService;
  cacheRedis: Redis;
} {
  const outbox = new OutboxService();
  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(cacheRedis);
  const permissions = new PermissionResolverService(db, cache);
  const tasksService = new TasksService(db, outbox);
  const costTransactionsService = new CostTransactionsService(db, outbox);
  const dailyReportsService = new DailyReportsService(db, outbox);
  const timeEntriesService = new TimeEntriesService(db, outbox, costTransactionsService);

  return {
    syncMutationsService: new SyncMutationsService(db, permissions, tasksService, dailyReportsService, timeEntriesService),
    syncDeltaService: new SyncDeltaService(db),
    syncWorkingSetService: new SyncWorkingSetService(db),
    syncConflictsService: new SyncConflictsService(db, permissions, tasksService, dailyReportsService, timeEntriesService),
    tasksService,
    dailyReportsService,
    timeEntriesService,
    cacheRedis,
  };
}
