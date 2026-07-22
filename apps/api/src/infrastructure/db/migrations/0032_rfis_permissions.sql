-- Custom SQL migration file, put your code below! --

-- api.md §8 (M3): docs.rfi.* wildcard covers GET/POST/PATCH /projects/{id}/rfis.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('docs.rfi.read', 'docs', 'rfi', 'read', 'View RFIs'),
  ('docs.rfi.create', 'docs', 'rfi', 'create', 'Create an RFI'),
  ('docs.rfi.update', 'docs', 'rfi', 'update', 'Update an RFI, including answering and status transitions')
ON CONFLICT (key) DO NOTHING;
