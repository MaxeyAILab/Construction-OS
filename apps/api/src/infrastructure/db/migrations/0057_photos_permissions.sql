-- Custom SQL migration file, put your code below! --

-- api.md conventions (M8 Field Operations, FR-FIELD-3). No update/delete
-- key — photos are append-only (database.md §15), same reasoning as
-- field.time_entry.* having no update.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('field.photo.read', 'field', 'photo', 'read', 'View photos'),
  ('field.photo.create', 'field', 'photo', 'create', 'Capture and upload a photo')
ON CONFLICT (key) DO NOTHING;
