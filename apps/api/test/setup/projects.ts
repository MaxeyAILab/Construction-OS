import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { CostCodesService } from "../../src/modules/projects/application/cost-codes.service";
import { MilestonesService } from "../../src/modules/projects/application/milestones.service";
import { ProjectMembersService } from "../../src/modules/projects/application/project-members.service";
import { ProjectSummaryService } from "../../src/modules/projects/application/project-summary.service";
import { ProjectTemplatesService } from "../../src/modules/projects/application/project-templates.service";
import { ProjectsQueryService } from "../../src/modules/projects/application/projects-query.service";
import { ProjectsService } from "../../src/modules/projects/application/projects.service";

export function buildTestProjectServices(db: Database) {
  const outbox = new OutboxService();
  const templates = new ProjectTemplatesService(db);
  return {
    projectsService: new ProjectsService(db, outbox, templates),
    projectsQueryService: new ProjectsQueryService(db),
    summaryService: new ProjectSummaryService(db),
    membersService: new ProjectMembersService(db, outbox),
    costCodesService: new CostCodesService(db, outbox),
    milestonesService: new MilestonesService(db, outbox),
    templatesService: templates,
  };
}
