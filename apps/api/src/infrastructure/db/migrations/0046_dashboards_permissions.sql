-- Custom SQL migration file, put your code below! --

-- api.md §14 (Reports & Dashboards API, M16) is the one section this
-- session that ships with no Permission column at all (verified against
-- the raw table — every other api.md section has one). Inferring keys
-- from api.md §1.1's module.resource.action convention, same as every
-- other gap-fill permission this session.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('dashboard.company.read', 'dashboard', 'company', 'read', 'View the company-wide executive KPI dashboard'),
  ('dashboard.project.read', 'dashboard', 'project', 'read', 'View a single project''s executive dashboard aggregate')
ON CONFLICT (key) DO NOTHING;