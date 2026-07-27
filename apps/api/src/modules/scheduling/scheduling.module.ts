import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createQueueConnection, QUEUE_CONNECTION } from "../../infrastructure/queue/connection";
import { AiModule } from "../ai";
import { EventsModule } from "../events";
import { RbacModule } from "../rbac";
import { SchedulingController } from "./api/scheduling.controller";
import { ActivitiesService } from "./application/activities.service";
import { DelayImpactService } from "./application/delay-impact.service";
import { DependenciesService } from "./application/dependencies.service";
import { LookaheadService } from "./application/lookahead.service";
import { RecalculateService } from "./application/recalculate.service";
import { ScheduleRecalcQueue } from "./application/recalculate.queue";
import { ResourceAssignmentsService } from "./application/resource-assignments.service";
import { ResourceConflictsService } from "./application/resource-conflicts.service";
import { SchedulesService } from "./application/schedules.service";
import { ScheduleRecalcWorker } from "./infrastructure/schedule-recalc.worker";

const env = loadEnv();

@Module({
  imports: [EventsModule, RbacModule, AiModule],
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
    ResourceAssignmentsService,
    LookaheadService,
    ResourceConflictsService,
    DelayImpactService,
  ],
  // Procurement AI (FR-PROC-6) reuses SchedulesService.getActiveSchedule()
  // for schedule_activities' cost-code/start-date data rather than
  // querying the table directly — same "broaden an existing module's
  // public surface" precedent as every other cross-module reuse this
  // session.
  exports: [SchedulesService],
})
export class SchedulingModule {}
