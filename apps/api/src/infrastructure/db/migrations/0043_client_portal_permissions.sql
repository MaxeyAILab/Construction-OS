-- Custom SQL migration file, put your code below! --

-- M13 Client Portal v1 (FR-CLIENT-2/3). No api.md section documents these
-- endpoints (api.md has no dedicated Client Portal API section at all —
-- confirmed by inspection), so these keys follow the same module.resource.
-- action convention as every other seed this session rather than a
-- literal api.md string.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('client.selection.read', 'client', 'selection', 'read', 'View client selections (allowances/options)'),
  ('client.selection.manage', 'client', 'selection', 'manage', 'Create/update client selections'),
  ('client.message.read', 'client', 'message', 'read', 'Read the client portal message thread'),
  ('client.message.create', 'client', 'message', 'create', 'Post to the client portal message thread')
ON CONFLICT (key) DO NOTHING;
