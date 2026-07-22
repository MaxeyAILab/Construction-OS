-- Custom SQL migration file, put your code below! --

-- api.md §9 (M9): finance.co.* wildcard covers GET/POST /change-orders;
-- submit and approve are broken out as their own permission keys since
-- api.md documents them as distinct, more-privileged actions
-- (finance.co.submit, finance.co.approve).
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('finance.co.read', 'finance', 'co', 'read', 'View change orders and their lines'),
  ('finance.co.create', 'finance', 'co', 'create', 'Create a change order (draft)'),
  ('finance.co.update', 'finance', 'co', 'update', 'Update a draft change order''s header/lines, or void it'),
  ('finance.co.submit', 'finance', 'co', 'submit', 'Submit a change order to the client for approval'),
  ('finance.co.approve', 'finance', 'co', 'approve', 'Approve or reject a submitted change order (internal)')
ON CONFLICT (key) DO NOTHING;
