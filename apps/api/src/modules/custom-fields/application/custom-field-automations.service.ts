import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateCustomFieldAutomationInput,
  CustomFieldEntityType,
  CustomFieldValue,
  UpdateCustomFieldAutomationInput,
} from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { customFieldAutomations, customFieldDefinitions, customFieldValues } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CustomFieldAutomationNotFoundError, FieldEntityTypeMismatchError } from "../domain/errors";

// database.md §24 / api.md §19 (FR-PLAT-12). The guard-rail against roadmap
// V2's "unmaintainable escape hatch" risk lives entirely in `evaluate`
// below: equality-only trigger match, a fixed two-member action
// vocabulary, and — critically — a set_field action writes
// custom_field_values directly rather than looping back through
// `evaluate`, so one automation can never fire another.
@Injectable()
export class CustomFieldAutomationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, entityType: CustomFieldEntityType) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.customFieldAutomations.findMany({
        where: and(eq(customFieldAutomations.entityType, entityType), isNull(customFieldAutomations.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, input: CreateCustomFieldAutomationInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.assertBelongsToEntityType(tx, input.triggerFieldId, input.entityType, "triggerFieldId");
      if (input.actionFieldId) {
        await this.assertBelongsToEntityType(tx, input.actionFieldId, input.entityType, "actionFieldId");
      }

      const [created] = await tx
        .insert(customFieldAutomations)
        .values({
          tenantId,
          entityType: input.entityType,
          name: input.name,
          triggerFieldDefinitionId: input.triggerFieldId,
          triggerValue: input.triggerValue,
          actionType: input.actionType,
          actionFieldDefinitionId: input.actionFieldId ?? null,
          actionValue: input.actionValue ?? null,
          actionNotifyUserId: input.actionNotifyUserId ?? null,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "custom_field_automation.created.v1",
        dedupeKey: `custom_field_automation.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, entityType: input.entityType, automationId: created!.id },
      });

      return created!;
    });
  }

  // Not the trigger/action fields or action_type — same "shape is fixed at
  // creation" reasoning as CustomFieldDefinitionsService.update.
  async update(tenantId: string, actorId: string, id: string, input: UpdateCustomFieldAutomationInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.customFieldAutomations.findFirst({
        where: and(eq(customFieldAutomations.id, id), isNull(customFieldAutomations.deletedAt)),
      });
      if (!existing) throw new CustomFieldAutomationNotFoundError();

      const changedFields = Object.keys(input);
      const [updated] = await tx
        .update(customFieldAutomations)
        .set({ ...input, updatedBy: actorId })
        .where(eq(customFieldAutomations.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "custom_field_automation.updated.v1",
        dedupeKey: `custom_field_automation.updated.v1:${id}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, automationId: id, changedFields },
      });

      return updated!;
    });
  }

  // Called by CustomFieldValuesService.setValue, inside the same
  // transaction as the value write it's reacting to. Equality-only match
  // against every active automation whose trigger is this field — no
  // operators, no expression evaluation.
  async evaluate(
    tx: Database,
    tenantId: string,
    actorId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    fieldDefinitionId: string,
    newValue: CustomFieldValue,
  ): Promise<void> {
    const candidates = await tx.query.customFieldAutomations.findMany({
      where: and(
        eq(customFieldAutomations.tenantId, tenantId),
        eq(customFieldAutomations.triggerFieldDefinitionId, fieldDefinitionId),
        eq(customFieldAutomations.isActive, true),
        isNull(customFieldAutomations.deletedAt),
      ),
    });

    for (const automation of candidates) {
      if (automation.triggerValue !== newValue) continue;

      if (automation.actionType === "set_field" && automation.actionFieldDefinitionId) {
        // Writes custom_field_values directly — deliberately does not call
        // back into this method, so this action can never trigger another
        // automation (database.md §24's "no chaining, by construction").
        await tx
          .insert(customFieldValues)
          .values({
            tenantId,
            fieldDefinitionId: automation.actionFieldDefinitionId,
            entityType,
            entityId,
            value: automation.actionValue,
            updatedBy: actorId,
          })
          .onConflictDoUpdate({
            target: [customFieldValues.tenantId, customFieldValues.fieldDefinitionId, customFieldValues.entityId],
            set: { value: automation.actionValue, updatedBy: actorId },
          });
      }

      await this.outbox.append(tx, {
        tenantId,
        eventType: "custom_field_automation.triggered.v1",
        dedupeKey: `custom_field_automation.triggered.v1:${automation.id}:${entityId}:${Date.now()}`,
        actorId,
        payload: {
          companyId: tenantId,
          entityType,
          entityId,
          automationId: automation.id,
          actionType: automation.actionType,
          notifyUserId: automation.actionType === "notify_user" ? automation.actionNotifyUserId : null,
        },
      });
    }
  }

  private async assertBelongsToEntityType(
    tx: Database,
    fieldId: string,
    entityType: CustomFieldEntityType,
    field: string,
  ): Promise<void> {
    const definition = await tx.query.customFieldDefinitions.findFirst({
      where: and(eq(customFieldDefinitions.id, fieldId), isNull(customFieldDefinitions.deletedAt)),
    });
    if (!definition || definition.entityType !== entityType) {
      throw new FieldEntityTypeMismatchError(field);
    }
  }
}
