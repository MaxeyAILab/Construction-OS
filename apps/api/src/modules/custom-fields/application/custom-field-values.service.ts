import { Inject, Injectable } from "@nestjs/common";
import type { CustomFieldEntityType, CustomFieldValue, UpsertCustomFieldValueInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { customFieldDefinitions, customFieldValues } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { PermissionDeniedError, PermissionResolverService } from "../../rbac";
import { CustomFieldAutomationsService } from "./custom-field-automations.service";
import { CustomFieldDefinitionNotFoundError, InvalidFieldValueError } from "../domain/errors";

type CustomFieldDefinitionRow = typeof customFieldDefinitions.$inferSelect;

// api.md §19: values have no single fixed permission — a request can
// target any allow-listed entity_type, each gated by that entity's own
// module's permission, not a platform one. Same "no single fixed
// permission fits" shape as Sync's /sync/mutations and Scheduling's
// getActiveSchedule(); this map is what the controller's @Authenticated()
// route defers to.
const ENTITY_PERMISSIONS: Record<CustomFieldEntityType, { read: string; write: string }> = {
  project: { read: "projects.project.read", write: "projects.project.update" },
  task: { read: "tasks.task.read", write: "tasks.task.update" },
  rfi: { read: "docs.rfi.read", write: "docs.rfi.update" },
  change_order: { read: "finance.co.read", write: "finance.co.update" },
  submittal: { read: "docs.submittal.read", write: "docs.submittal.update" },
};

function assertValueMatchesType(definition: CustomFieldDefinitionRow, value: CustomFieldValue): void {
  if (value === null) {
    if (definition.isRequired) throw new InvalidFieldValueError(`${definition.fieldKey} is required`);
    return;
  }
  switch (definition.fieldType) {
    case "text":
      if (typeof value !== "string") throw new InvalidFieldValueError(`${definition.fieldKey} expects a string`);
      break;
    case "number":
      if (typeof value !== "number") throw new InvalidFieldValueError(`${definition.fieldKey} expects a number`);
      break;
    case "boolean":
      if (typeof value !== "boolean") throw new InvalidFieldValueError(`${definition.fieldKey} expects a boolean`);
      break;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new InvalidFieldValueError(`${definition.fieldKey} expects an ISO-8601 date (YYYY-MM-DD)`);
      }
      break;
    case "select": {
      const options = (definition.options as string[] | null) ?? [];
      if (typeof value !== "string" || !options.includes(value)) {
        throw new InvalidFieldValueError(`${definition.fieldKey} expects one of: ${options.join(", ")}`);
      }
      break;
    }
  }
}

// database.md §24: the only place a custom field's value lives — Projects/
// Tasks/RFIs/Change Orders/Submittals never gain a column for it, and this
// service never writes to their tables (module-boundary rule).
@Injectable()
export class CustomFieldValuesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly permissions: PermissionResolverService,
    private readonly automations: CustomFieldAutomationsService,
  ) {}

  async list(tenantId: string, userId: string, entityType: CustomFieldEntityType, entityId: string) {
    await this.authorize(tenantId, userId, entityType, "read");

    return withTenant(this.db, tenantId, async (tx) => {
      const definitions = await tx.query.customFieldDefinitions.findMany({
        where: and(
          eq(customFieldDefinitions.entityType, entityType),
          eq(customFieldDefinitions.isActive, true),
          isNull(customFieldDefinitions.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
      });
      const values = await tx.query.customFieldValues.findMany({
        where: and(eq(customFieldValues.entityType, entityType), eq(customFieldValues.entityId, entityId)),
      });
      const byFieldId = new Map(values.map((v) => [v.fieldDefinitionId, v.value as CustomFieldValue]));

      return definitions.map((d) => ({
        fieldId: d.id,
        fieldKey: d.fieldKey,
        label: d.label,
        fieldType: d.fieldType,
        options: d.options,
        isRequired: d.isRequired,
        value: byFieldId.get(d.id) ?? null,
      }));
    });
  }

  async setValue(tenantId: string, userId: string, input: UpsertCustomFieldValueInput) {
    await this.authorize(tenantId, userId, input.entityType, "write");

    return withTenant(this.db, tenantId, async (tx) => {
      const definition = await tx.query.customFieldDefinitions.findFirst({
        where: and(
          eq(customFieldDefinitions.id, input.fieldId),
          eq(customFieldDefinitions.entityType, input.entityType),
          eq(customFieldDefinitions.isActive, true),
          isNull(customFieldDefinitions.deletedAt),
        ),
      });
      if (!definition) throw new CustomFieldDefinitionNotFoundError();
      assertValueMatchesType(definition, input.value);

      const [row] = await tx
        .insert(customFieldValues)
        .values({
          tenantId,
          fieldDefinitionId: input.fieldId,
          entityType: input.entityType,
          entityId: input.entityId,
          value: input.value,
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [customFieldValues.tenantId, customFieldValues.fieldDefinitionId, customFieldValues.entityId],
          set: { value: input.value, updatedBy: userId },
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "custom_field_value.set.v1",
        dedupeKey: `custom_field_value.set.v1:${row!.id}:${row!.updatedSeq}`,
        actorId: userId,
        payload: { companyId: tenantId, entityType: input.entityType, entityId: input.entityId, fieldDefinitionId: input.fieldId },
      });

      // Evaluates in the same transaction as the value write it reacts to
      // — see CustomFieldAutomationsService's own doc comment for the
      // no-chaining guarantee this relies on.
      await this.automations.evaluate(
        tx,
        tenantId,
        userId,
        input.entityType,
        input.entityId,
        input.fieldId,
        input.value,
      );

      return row!;
    });
  }

  private async authorize(
    tenantId: string,
    userId: string,
    entityType: CustomFieldEntityType,
    mode: "read" | "write",
  ): Promise<void> {
    const required = ENTITY_PERMISSIONS[entityType][mode];
    const granted = await this.permissions.has(tenantId, userId, required);
    if (!granted) throw new PermissionDeniedError(required);
  }
}
