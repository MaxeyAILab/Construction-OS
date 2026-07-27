-- Custom SQL migration file, put your code below! --

-- api.md §6 (M7): "GET /resources/conflicts?from=&to= | schedule.resources
-- | Cross-project crew/equipment conflicts (FR-SCH-5)" — reserved (not
-- seeded) by 0038_scheduling_permissions.sql's own comment pending this
-- roadmap row.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('schedule.resources', 'schedule', 'schedule', 'resources', 'View cross-project crew/equipment resource conflicts')
ON CONFLICT (key) DO NOTHING;