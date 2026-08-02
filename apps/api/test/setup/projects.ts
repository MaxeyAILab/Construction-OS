import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { FinancialSummaryService } from "../../src/modules/budgets/application/financial-summary.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { CostCodesService } from "../../src/modules/projects/application/cost-codes.service";
import { MilestonesService } from "../../src/modules/projects/application/milestones.service";
import { ProjectMembersService } from "../../src/modules/projects/application/project-members.service";
import { ProjectSummaryService } from "../../src/modules/projects/application/project-summary.service";
import { ProjectTemplatesService } from "../../src/modules/projects/application/project-templates.service";
import { ProjectsQueryService } from "../../src/modules/projects/application/projects-query.service";
import { ProjectsService } from "../../src/modules/projects/application/projects.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { RfisService } from "../../src/modules/rfis/application/rfis.service";
import { SchedulesService } from "../../src/modules/scheduling/application/schedules.service";
import { TasksService } from "../../src/modules/tasks/application/tasks.service";

// FR-PM-3: ProjectSummaryService reads across Budgets/Scheduling/Tasks/RFIs,
// so this builder wires minimal instances of each the same way
// buildTestExecutiveBriefingService composes cross-module services for a
// single aggregate under test — a dedicated redis client backs
// SchedulesService's permission check and must be quit() by the caller.
export function buildTestProjectServices(db: Database): {
  projectsService: ProjectsService;
  projectsQueryService: ProjectsQueryService;
  summaryService: ProjectSummaryService;
  membersService: ProjectMembersService;
  costCodesService: CostCodesService;
  milestonesService: MilestonesService;
  templatesService: ProjectTemplatesService;
  schedulesService: SchedulesService;
  tasksService: TasksService;
  rfisService: RfisService;
  financialSummaryService: FinancialSummaryService;
  redis: RedisClient;
} {
  const outbox = new OutboxService();
  const templates = new ProjectTemplatesService(db);
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const permissions = new PermissionResolverService(db, new PermissionCacheService(redis));
  const externalShares = new ExternalSharesService(db, outbox);
  const financialSummaryService = new FinancialSummaryService(db);
  const schedulesService = new SchedulesService(db, outbox, permissions, externalShares);
  const tasksService = new TasksService(db, outbox);
  const rfisService = new RfisService(db, outbox);

  return {
    projectsService: new ProjectsService(db, outbox, templates),
    projectsQueryService: new ProjectsQueryService(db),
    summaryService: new ProjectSummaryService(db, financialSummaryService, schedulesService, tasksService, rfisService),
    membersService: new ProjectMembersService(db, outbox),
    costCodesService: new CostCodesService(db, outbox),
    milestonesService: new MilestonesService(db, outbox),
    templatesService: templates,
    schedulesService,
    tasksService,
    rfisService,
    financialSummaryService,
    redis,
  };
}
