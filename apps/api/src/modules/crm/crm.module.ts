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
  // Finance invoices (Budget module) reuse ContactCompaniesService to
  // validate counterparty_type='client' invoices (FR-VEND-2/FR-FIN-4
  // pay-apps) — same "broaden an existing module's public surface"
  // precedent as every other cross-module reuse this session.
  // WhatIfSimulationService (dashboards module, FR-EXEC-4 "bid loss"
  // what-if scenario) additionally reuses OpportunitiesService's pipeline
  // read.
  exports: [ContactCompaniesService, OpportunitiesService],
})
export class CrmModule {}
