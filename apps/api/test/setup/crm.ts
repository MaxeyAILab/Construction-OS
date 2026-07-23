import type { Database } from "../../src/infrastructure/db/client";
import { ActivitiesService } from "../../src/modules/crm/application/activities.service";
import { ContactCompaniesService } from "../../src/modules/crm/application/contact-companies.service";
import { ContactsService } from "../../src/modules/crm/application/contacts.service";
import { OpportunitiesService } from "../../src/modules/crm/application/opportunities.service";
import { OpportunityLifecycleService } from "../../src/modules/crm/application/opportunity-lifecycle.service";
import { PipelineStagesService } from "../../src/modules/crm/application/pipeline-stages.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { ProjectsService } from "../../src/modules/projects/application/projects.service";

export function buildTestCrmServices(db: Database, projectsService: ProjectsService) {
  const outbox = new OutboxService();
  return {
    contactsService: new ContactsService(db, outbox),
    contactCompaniesService: new ContactCompaniesService(db, outbox),
    pipelineStagesService: new PipelineStagesService(db, outbox),
    opportunitiesService: new OpportunitiesService(db, outbox),
    lifecycleService: new OpportunityLifecycleService(db, outbox, projectsService),
    activitiesService: new ActivitiesService(db, outbox),
  };
}
