import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { TasksModule } from "../tasks";
import { CertificationsController } from "./api/certifications.controller";
import { IncidentsController } from "./api/incidents.controller";
import { SafetyFormTemplatesController } from "./api/safety-form-templates.controller";
import { SafetyFormsController } from "./api/safety-forms.controller";
import { CertificationsService } from "./application/certifications.service";
import { IncidentsService } from "./application/incidents.service";
import { SafetyFormTemplatesService } from "./application/safety-form-templates.service";
import { SafetyFormsService } from "./application/safety-forms.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, TasksModule],
  controllers: [SafetyFormTemplatesController, SafetyFormsController, IncidentsController, CertificationsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    SafetyFormTemplatesService,
    SafetyFormsService,
    IncidentsService,
    CertificationsService,
  ],
  exports: [SafetyFormTemplatesService, SafetyFormsService, IncidentsService, CertificationsService],
})
export class SafetyModule {}
