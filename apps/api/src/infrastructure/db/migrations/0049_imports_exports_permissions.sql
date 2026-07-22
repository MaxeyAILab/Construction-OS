-- Custom SQL migration file, put your code below! --

-- api.md §14's /exports/{entity} and /imports rows (FR-PLAT-7, M18 Platform/
-- Admin per spec.md's module table) have no Permission column either — same
-- gap as the Reports & Dashboards rows in the same section. module='platform'
-- to match spec.md's module placement, one combined manage permission each
-- (not split read/write) since exporting/importing a tenant's data is a
-- single "do you have data-migration rights" grant, same precedent as
-- admin.share.manage.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('platform.export.manage', 'platform', 'export', 'manage', 'Request and download full data exports'),
  ('platform.import.manage', 'platform', 'import', 'manage', 'Run guided CSV imports (map, validate, commit)')
ON CONFLICT (key) DO NOTHING;