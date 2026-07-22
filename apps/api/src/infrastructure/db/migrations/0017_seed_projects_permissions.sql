-- Custom SQL migration file, put your code below! --

-- api.md §3 (M4): base project.read/create/update/delete plus two
-- distinctly-permissioned sub-resources (member management, cost-code WBS
-- management). Milestones and the /summary read reuse the base
-- projects.project.{read,update} permissions — api.md's table lists them
-- as bare "read"/"update" rather than spelling out a separate permission
-- string, unlike members/cost-codes which get their own row.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('projects.project.read', 'projects', 'project', 'read', 'View projects and their detail/summary'),
  ('projects.project.create', 'projects', 'project', 'create', 'Create a project'),
  ('projects.project.update', 'projects', 'project', 'update', 'Update a project, its status, and its milestones'),
  ('projects.project.delete', 'projects', 'project', 'delete', 'Soft-delete a project'),
  ('projects.member.manage', 'projects', 'member', 'manage', 'Add or remove project team members'),
  ('projects.costcode.manage', 'projects', 'costcode', 'manage', 'Create and update project cost codes (WBS)')
ON CONFLICT (key) DO NOTHING;
