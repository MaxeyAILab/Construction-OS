-- Custom SQL migration file, put your code below! --

-- api.md §8 (M3): "GET/POST/PATCH /projects/{id}/submittals | docs.submittal.*
-- | Review workflow." docs.document.comment mirrors tasks.task.comment's
-- convention for api.md's "comment" permission on
-- GET/POST /document-versions/{id}/annotations.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('docs.submittal.read', 'docs', 'submittal', 'read', 'View submittals'),
  ('docs.submittal.create', 'docs', 'submittal', 'create', 'Create a submittal'),
  ('docs.submittal.update', 'docs', 'submittal', 'update', 'Update a submittal, including review status transitions'),
  ('docs.document.comment', 'docs', 'document', 'comment', 'Add markup annotations to a document version')
ON CONFLICT (key) DO NOTHING;