import type { Database } from "../../src/infrastructure/db/client";
import { CustomFieldAutomationsService } from "../../src/modules/custom-fields/application/custom-field-automations.service";
import { CustomFieldDefinitionsService } from "../../src/modules/custom-fields/application/custom-field-definitions.service";
import { CustomFieldValuesService } from "../../src/modules/custom-fields/application/custom-field-values.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";

export function buildTestCustomFieldsServices(db: Database, permissions: PermissionResolverService) {
  const outbox = new OutboxService();
  const definitionsService = new CustomFieldDefinitionsService(db, outbox);
  const automationsService = new CustomFieldAutomationsService(db, outbox);
  const valuesService = new CustomFieldValuesService(db, outbox, permissions, automationsService);

  return { definitionsService, automationsService, valuesService };
}
