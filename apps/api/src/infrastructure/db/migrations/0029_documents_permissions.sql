-- Custom SQL migration file, put your code below! --

-- api.md §8 (M3): docs.document.* covers folders + documents + versions
-- (GET/POST /projects/{id}/folders · /documents, versions:initiate/complete,
-- download); docs.drawings.manage covers drawing sets + publish.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('docs.document.read', 'docs', 'document', 'read', 'View folders, documents, versions, and download files'),
  ('docs.document.create', 'docs', 'document', 'create', 'Create folders and documents, and upload new versions'),
  ('docs.document.update', 'docs', 'document', 'update', 'Rename/move a document or folder'),
  ('docs.drawings.manage', 'docs', 'drawings', 'manage', 'Create drawing sets and publish the field working set')
ON CONFLICT (key) DO NOTHING;
