-- Custom SQL migration file, put your code below! --

-- api.md §10: "GET/POST /integrations/accounting/… | admin.integration.manage
-- | Connect, mapping, sync runs, conflict queue (FR-PLAT-8)." One permission
-- gates the whole row, same "single permission column for a whole endpoint
-- group" precedent as every other api.md table entry that lists one key for
-- several methods/paths.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.integration.manage', 'admin', 'integration', 'manage', 'Connect/disconnect accounting integrations, manage account mapping, trigger sync runs, resolve sync conflicts')
ON CONFLICT (key) DO NOTHING;
