import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { ProjectsModule } from "../projects";
import { ContactCompaniesController } from "./api/contact-companies.controller";
import { ContactsController } from "./api/contacts.controller";
import { OpportunitiesController } from "./api/opportunities.controller";
import { PipelineStagesController } from "./api/pipeline-stages.controller";
import { ActivitiesService } from "./application/activities.service";
import { ContactCompaniesService } from "./application/contact-companies.service";
import { ContactsService } from "./application/contacts.service";
import { OpportunitiesService } from "./application/opportunities.service";
import { OpportunityLifecycleService } from "./application/opportunity-lifecycle.service";
import { PipelineStagesService } from "./application/pipeline-stages.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, ProjectsModule],
  controllers: [ContactsController, ContactCompaniesController, PipelineStagesController, OpportunitiesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    ContactsService,
    ContactCompaniesService,
    PipelineStagesService,
    OpportunitiesService,
    OpportunityLifecycleService,
    ActivitiesService,
  ],
})
export class CrmModule {}
