-- Custom SQL migration file, put your code below! --

-- api.md §15: "GET/PATCH /admin/company | admin.company.manage | Settings,
-- locale, branding, fiscal config." Roadmap Phase 2 "Second locale +
-- metric units (NFR-30 activation)" row — this is the permission gating
-- tenant-settings mutation (unit system, fiscal year start, branding) on
-- the companies row.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.company.manage', 'admin', 'company', 'manage', 'View/update company settings: locale, currency, unit system, branding, fiscal config')
ON CONFLICT (key) DO NOTHING;
