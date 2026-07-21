-- Custom SQL migration file, put your code below! --

-- Platform permission catalog (database.md §7, api.md §1.1, spec §10):
-- module.resource.action. Seeded here for capabilities that exist right
-- now (RBAC administration itself, company membership); each future
-- module adds its own permission rows alongside its own migration rather
-- than this file growing to cover modules that don't exist yet.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('platform.role.read', 'platform', 'role', 'read', 'View roles and their permissions'),
  ('platform.role.manage', 'platform', 'role', 'manage', 'Create, update, delete roles and their permission grants'),
  ('platform.company_user.invite', 'platform', 'company_user', 'invite', 'Invite a user to the company'),
  ('platform.company_user.remove', 'platform', 'company_user', 'remove', 'Remove a user from the company'),
  ('platform.user_role.assign', 'platform', 'user_role', 'assign', 'Assign a role to a user'),
  ('platform.user_role.revoke', 'platform', 'user_role', 'revoke', 'Revoke a role from a user')
ON CONFLICT (key) DO NOTHING;