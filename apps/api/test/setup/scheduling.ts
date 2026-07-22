import type Redis from "ioredis";
import { createQueueConnection } from "../../src/infrastructure/queue/connection";
import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
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
} {
  const outbox = new OutboxService();
  const schedulesService = new SchedulesService(db, outbox);
  const activitiesService = new ActivitiesService(db, outbox, schedulesService);
  const dependenciesService = new DependenciesService(db, outbox, schedulesService);
  const queueConnection = createQueueConnection({
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  });
  const queue = new ScheduleRecalcQueue(queueConnection);
  const recalculateService = new RecalculateService(db, outbox, schedulesService, queue);

  return { schedulesService, activitiesService, dependenciesService, recalculateService, queueConnection };
}
