import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createQueueConnection, QUEUE_CONNECTION } from "../../infrastructure/queue/connection";
import { EventsModule } from "../events";
import { RbacModule } from "../rbac";
import { SchedulingController } from "./api/scheduling.controller";
import { ActivitiesService } from "./application/activities.service";
import { DependenciesService } from "./application/dependencies.service";
import { RecalculateService } from "./application/recalculate.service";
import { ScheduleRecalcQueue } from "./application/recalculate.queue";
import { SchedulesService } from "./application/schedules.service";
import { ScheduleRecalcWorker } from "./infrastructure/schedule-recalc.worker";

const env = loadEnv();

@Module({
  imports: [EventsModule, RbacModule],
  controllers: [SchedulingController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: QUEUE_CONNECTION, useFactory: () => createQueueConnection(env) },
    SchedulesService,
    ActivitiesService,
    DependenciesService,
    ScheduleRecalcQueue,
    RecalculateService,
    ScheduleRecalcWorker,
  ],
})
export class SchedulingModule {}
