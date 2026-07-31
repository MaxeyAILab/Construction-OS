import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateCustomFieldDefinitionInput,
  CustomFieldEntityType,
  UpdateCustomFieldDefinitionInput,
} from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { customFieldDefinitions } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CustomFieldDefinitionNotFoundError, DuplicateFieldKeyError } from "../domain/errors";

// api.md §19 / database.md §24 (FR-PLAT-11). The definitions table's only
// write path — CustomFieldValuesService/CustomFieldAutomationsService read
// it directly (same module) but never write it outside these methods.
@Injectable()
export class CustomFieldDefinitionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, entityType: CustomFieldEntityType) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.customFieldDefinitions.findMany({
        where: and(eq(customFieldDefinitions.entityType, entityType), isNull(customFieldDefinitions.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
      }),
    );
  }

  async getActive(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.customFieldDefinitions.findFirst({
        where: and(eq(customFieldDefinitions.id, id), isNull(customFieldDefinitions.deletedAt)),
      }),
    );
  }

  async create(tenantId: string, actorId: string, input: CreateCustomFieldDefinitionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.customFieldDefinitions.findFirst({
        where: and(
          eq(customFieldDefinitions.entityType, input.entityType),
          eq(customFieldDefinitions.fieldKey, input.fieldKey),
          isNull(customFieldDefinitions.deletedAt),
        ),
      });
      if (existing) throw new DuplicateFieldKeyError();

      const [created] = await tx
        .insert(customFieldDefinitions)
        .values({
          tenantId,
          entityType: input.entityType,
          fieldKey: input.fieldKey,
          label: input.label,
          fieldType: input.fieldType,
          options: input.options ?? null,
          isRequired: input.isRequired ?? false,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "custom_field_definition.created.v1",
        dedupeKey: `custom_field_definition.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, entityType: input.entityType, fieldDefinitionId: created!.id },
      });

      return created!;
    });
  }

  // field_type and entity_type are immutable once created — see this
  // service's own module doc comment / api.md §19 for why.
  async update(tenantId: string, actorId: string, id: string, input: UpdateCustomFieldDefinitionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.customFieldDefinitions.findFirst({
        where: and(eq(customFieldDefinitions.id, id), isNull(customFieldDefinitions.deletedAt)),
      });
      if (!existing) throw new CustomFieldDefinitionNotFoundError();

      const changedFields = Object.keys(input);
      const [updated] = await tx
        .update(customFieldDefinitions)
        .set({ ...input, updatedBy: actorId })
        .where(eq(customFieldDefinitions.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "custom_field_definition.updated.v1",
        dedupeKey: `custom_field_definition.updated.v1:${id}:${updated!.updatedSeq}`,
        actorId,
        payload: { companyId: tenantId, fieldDefinitionId: id, changedFields },
      });

      return updated!;
    });
  }
}
