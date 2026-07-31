import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { users } from "./users";

// database.md §24 (FR-PLAT-11/12). The entity_type allow-list is the
// guard-rail itself (roadmap V2 risk register: "guard-railed primitives
// only... no arbitrary scripting") — widening it is a migration, not a
// tenant-facing config option.
const ENTITY_TYPES_SQL = sql`'project', 'task', 'rfi', 'change_order', 'submittal'`;
const FIELD_TYPES_SQL = sql`'text', 'number', 'boolean', 'date', 'select'`;

// A field with existing values is deactivated (is_active), never deleted —
// its custom_field_values rows must stay resolvable.
export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    ...tenantColumns(),
    entityType: text("entity_type").notNull(),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    options: jsonb("options"),
    isRequired: boolean("is_required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    check("ck_custom_field_definitions_entity_type", sql`${table.entityType} in (${ENTITY_TYPES_SQL})`),
    check("ck_custom_field_definitions_field_type", sql`${table.fieldType} in (${FIELD_TYPES_SQL})`),
    uniqueIndex("ux_custom_field_definitions_tenant_entity_key")
      .on(table.tenantId, table.entityType, table.fieldKey)
      .where(sql`${table.deletedAt} is null`),
    index("ix_custom_field_definitions_tenant_entity").on(table.tenantId, table.entityType),
  ],
);

// One row per (field_definition_id, entity_id) — the only place a custom
// field's value lives; consuming modules (Projects/Tasks/RFIs/Change
// Orders/Submittals) never gain a column for it, and this module never
// writes to their tables (module-boundary rule). `value`'s shape is
// validated against the definition's field_type/options at the
// application layer, not by a CHECK — same "type discipline lives in
// zod because the type varies per row" reasoning as photos.ai_tags.
export const customFieldValues = pgTable(
  "custom_field_values",
  {
    ...tenantColumns(),
    fieldDefinitionId: uuid("field_definition_id")
      .notNull()
      .references(() => customFieldDefinitions.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    value: jsonb("value").notNull(),
  },
  (table) => [
    check("ck_custom_field_values_entity_type", sql`${table.entityType} in (${ENTITY_TYPES_SQL})`),
    uniqueIndex("ux_custom_field_values_tenant_field_entity").on(
      table.tenantId,
      table.fieldDefinitionId,
      table.entityId,
    ),
    index("ix_custom_field_values_tenant_entity").on(table.tenantId, table.entityType, table.entityId),
  ],
);

// Fixed two-member action vocabulary, equality-only trigger, no chaining
// (a set_field action writes custom_field_values directly, bypassing
// automation evaluation entirely) — the entire guard-rail against roadmap
// V2's "unmaintainable escape hatch" risk lives in those three
// constraints, not in a sandbox or step-count limiter.
export const customFieldAutomations = pgTable(
  "custom_field_automations",
  {
    ...tenantColumns(),
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    triggerFieldDefinitionId: uuid("trigger_field_definition_id")
      .notNull()
      .references(() => customFieldDefinitions.id),
    triggerValue: jsonb("trigger_value").notNull(),
    actionType: text("action_type").notNull(),
    actionFieldDefinitionId: uuid("action_field_definition_id").references(() => customFieldDefinitions.id),
    actionValue: jsonb("action_value"),
    actionNotifyUserId: uuid("action_notify_user_id").references(() => users.id),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    check("ck_custom_field_automations_entity_type", sql`${table.entityType} in (${ENTITY_TYPES_SQL})`),
    check("ck_custom_field_automations_action_type", sql`${table.actionType} in ('set_field', 'notify_user')`),
    index("ix_custom_field_automations_trigger")
      .on(table.tenantId, table.triggerFieldDefinitionId)
      .where(sql`${table.isActive} and ${table.deletedAt} is null`),
  ],
);
