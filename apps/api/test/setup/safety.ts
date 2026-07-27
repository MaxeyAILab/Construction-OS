import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { CertificationsService } from "../../src/modules/safety/application/certifications.service";
import { IncidentsService } from "../../src/modules/safety/application/incidents.service";
import { SafetyFormTemplatesService } from "../../src/modules/safety/application/safety-form-templates.service";
import { SafetyFormsService } from "../../src/modules/safety/application/safety-forms.service";
import { TasksService } from "../../src/modules/tasks/application/tasks.service";

export function buildTestSafetyServices(db: Database) {
  const outbox = new OutboxService();
  const templatesService = new SafetyFormTemplatesService(db, outbox);
  const tasksService = new TasksService(db, outbox);
  return {
    templatesService,
    formsService: new SafetyFormsService(db, outbox, templatesService),
    incidentsService: new IncidentsService(db, outbox, tasksService),
    certificationsService: new CertificationsService(db, outbox),
    tasksService,
  };
}
