import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { ProjectsController } from "./api/projects.controller";
import { CostCodesService } from "./application/cost-codes.service";
import { MilestonesService } from "./application/milestones.service";
import { ProjectMembersService } from "./application/project-members.service";
import { ProjectSummaryService } from "./application/project-summary.service";
import { ProjectTemplatesService } from "./application/project-templates.service";
import { ProjectsQueryService } from "./application/projects-query.service";
import { ProjectsService } from "./application/projects.service";
import { IdempotencyInterceptor } from "../../platform/idempotency/idempotency.interceptor";

const env = loadEnv();

@Module({
  imports: [EventsModule],
  controllers: [ProjectsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    ProjectsService,
    ProjectsQueryService,
    ProjectSummaryService,
    ProjectMembersService,
    CostCodesService,
    MilestonesService,
    ProjectTemplatesService,
    IdempotencyInterceptor,
  ],
  // CostCodesService: M18 guided imports (FR-PLAT-7) reuse it for the
  // cost_codes commit step rather than duplicating duplicate-code/parent-
  // validation/outbox-event logic — same "broaden an existing module's
  // public surface for a legitimate new cross-module need" precedent as
  // Client Portal's earlier broadening of Scheduling/Documents.
  exports: [CostCodesService],
})
export class ProjectsModule {}
