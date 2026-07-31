-- Custom SQL migration file, put your code below! --

-- api.md §19 (M18, FR-PLAT-11/12). Only field/automation definitions are
-- admin-gated — value read/write has no single fixed permission (it's
-- resolved per entity_type inside CustomFieldValuesService, see that
-- service's own comment), so there is no admin.custom_field.value_* key.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.custom_field.manage', 'admin', 'custom_field', 'manage', 'Define, update, and deactivate custom field definitions and their automations')
ON CONFLICT (key) DO NOTHING;
