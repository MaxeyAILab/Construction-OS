import type Redis from "ioredis";
import { createQueueConnection } from "../../src/infrastructure/queue/connection";
import { createRedisClient } from "../../src/infrastructure/redis/client";
import type { Database } from "../../src/infrastructure/db/client";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { ActivitiesService } from "../../src/modules/scheduling/application/activities.service";
import { DelayImpactService } from "../../src/modules/scheduling/application/delay-impact.service";
import { DependenciesService } from "../../src/modules/scheduling/application/dependencies.service";
import { LookaheadService } from "../../src/modules/scheduling/application/lookahead.service";
import { PredictiveScheduleRiskService } from "../../src/modules/scheduling/application/predictive-schedule-risk.service";
import { ScheduleRecalcQueue } from "../../src/modules/scheduling/application/recalculate.queue";
import { RecalculateService } from "../../src/modules/scheduling/application/recalculate.service";
import { ResourceAssignmentsService } from "../../src/modules/scheduling/application/resource-assignments.service";
import { ResourceConflictsService } from "../../src/modules/scheduling/application/resource-conflicts.service";
import { SchedulesService } from "../../src/modules/scheduling/application/schedules.service";
import { FakeAiProvider } from "./ai";

export function buildTestSchedulingServices(db: Database): {
  schedulesService: SchedulesService;
  activitiesService: ActivitiesService;
  dependenciesService: DependenciesService;
  recalculateService: RecalculateService;
  resourceAssignmentsService: ResourceAssignmentsService;
  lookaheadService: LookaheadService;
  resourceConflictsService: ResourceConflictsService;
  delayImpactService: DelayImpactService;
  delayImpactAiProvider: FakeAiProvider;
  predictiveScheduleRiskService: PredictiveScheduleRiskService;
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
  const resourceAssignmentsService = new ResourceAssignmentsService(db, outbox);
  const lookaheadService = new LookaheadService(schedulesService);
  const resourceConflictsService = new ResourceConflictsService(db);
  const delayImpactAiProvider = new FakeAiProvider();
  const delayImpactService = new DelayImpactService(db, schedulesService, new AiGatewayService(db, delayImpactAiProvider));
  const predictiveScheduleRiskService = new PredictiveScheduleRiskService(db, schedulesService);

  return {
    schedulesService,
    activitiesService,
    dependenciesService,
    recalculateService,
    resourceAssignmentsService,
    lookaheadService,
    resourceConflictsService,
    delayImpactService,
    delayImpactAiProvider,
    predictiveScheduleRiskService,
    queueConnection,
    cacheRedis,
  };
}
