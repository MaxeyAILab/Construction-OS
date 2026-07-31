import { z } from "zod";
import { uuidSchema } from "./common";

// database.md §24 / api.md §19 (FR-PLAT-11/12). The entity_type allow-list
// is the guard-rail itself (roadmap V2 risk register: "guard-railed
// primitives only... no arbitrary scripting") — widening it is a
// migration, not a tenant-facing config option.
export const customFieldEntityTypeSchema = z.enum(["project", "task", "rfi", "change_order", "submittal"]);
export type CustomFieldEntityType = z.infer<typeof customFieldEntityTypeSchema>;

export const customFieldTypeSchema = z.enum(["text", "number", "boolean", "date", "select"]);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

// A field's value crosses the wire as one of these primitives — no
// arrays/objects, so a value can never smuggle in more structure than the
// field_type it's supposed to represent.
export const customFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

export const createCustomFieldDefinitionSchema = z
  .object({
    entityType: customFieldEntityTypeSchema,
    fieldKey: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, "expected a lowercase snake_case key"),
    label: z.string().min(1),
    fieldType: customFieldTypeSchema,
    options: z.array(z.string().min(1)).optional(),
    isRequired: z.boolean().optional(),
  })
  .refine((v) => v.fieldType !== "select" || (v.options && v.options.length > 0), {
    message: "options is required (and non-empty) when fieldType is 'select'",
    path: ["options"],
  });
export type CreateCustomFieldDefinitionInput = z.infer<typeof createCustomFieldDefinitionSchema>;

// field_type and entity_type are immutable once created — changing either
// would invalidate every existing value row's assumed shape (api.md §19).
export const updateCustomFieldDefinitionSchema = z.object({
  label: z.string().min(1).optional(),
  options: z.array(z.string().min(1)).optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCustomFieldDefinitionInput = z.infer<typeof updateCustomFieldDefinitionSchema>;

export const listCustomFieldDefinitionsQuerySchema = z.object({
  entityType: customFieldEntityTypeSchema,
});
export type ListCustomFieldDefinitionsQuery = z.infer<typeof listCustomFieldDefinitionsQuerySchema>;

export const listCustomFieldValuesQuerySchema = z.object({
  entityType: customFieldEntityTypeSchema,
  entityId: uuidSchema,
});
export type ListCustomFieldValuesQuery = z.infer<typeof listCustomFieldValuesQuerySchema>;

export const upsertCustomFieldValueSchema = z.object({
  entityType: customFieldEntityTypeSchema,
  entityId: uuidSchema,
  fieldId: uuidSchema,
  value: customFieldValueSchema,
});
export type UpsertCustomFieldValueInput = z.infer<typeof upsertCustomFieldValueSchema>;

// Fixed two-member action vocabulary — the entire guard-rail against
// roadmap V2's "unmaintainable escape hatch" risk, alongside the
// equality-only trigger below and the no-chaining rule enforced in
// CustomFieldAutomationsService (never in this schema layer).
export const customFieldAutomationActionTypeSchema = z.enum(["set_field", "notify_user"]);
export type CustomFieldAutomationActionType = z.infer<typeof customFieldAutomationActionTypeSchema>;

export const createCustomFieldAutomationSchema = z
  .object({
    entityType: customFieldEntityTypeSchema,
    name: z.string().min(1),
    triggerFieldId: uuidSchema,
    triggerValue: customFieldValueSchema,
    actionType: customFieldAutomationActionTypeSchema,
    actionFieldId: uuidSchema.optional(),
    actionValue: customFieldValueSchema.optional(),
    actionNotifyUserId: uuidSchema.optional(),
  })
  .refine((v) => v.actionType !== "set_field" || (!!v.actionFieldId && v.actionValue !== undefined), {
    message: "actionFieldId and actionValue are required when actionType is 'set_field'",
    path: ["actionFieldId"],
  })
  .refine((v) => v.actionType !== "notify_user" || !!v.actionNotifyUserId, {
    message: "actionNotifyUserId is required when actionType is 'notify_user'",
    path: ["actionNotifyUserId"],
  });
export type CreateCustomFieldAutomationInput = z.infer<typeof createCustomFieldAutomationSchema>;

// Not the trigger/action fields or action_type — same "shape is fixed at
// creation" reasoning as field definitions above.
export const updateCustomFieldAutomationSchema = z.object({
  name: z.string().min(1).optional(),
  triggerValue: customFieldValueSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCustomFieldAutomationInput = z.infer<typeof updateCustomFieldAutomationSchema>;

export const listCustomFieldAutomationsQuerySchema = z.object({
  entityType: customFieldEntityTypeSchema,
});
export type ListCustomFieldAutomationsQuery = z.infer<typeof listCustomFieldAutomationsQuerySchema>;
