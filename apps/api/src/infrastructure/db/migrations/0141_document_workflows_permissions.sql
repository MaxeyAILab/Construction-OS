-- Custom SQL migration file, put your code below! --

-- api.md §20 (M3, FR-DOC-8/9). Approval-instance decide/acknowledge have
-- no permission key at all — they're identity checks (the caller must be
-- the transmittal's own recipient, or the current step's named approver),
-- enforced in the service, same shape as this module's own api.md doc
-- comment explains.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('docs.transmittal.read', 'docs', 'transmittal', 'read', 'View transmittals and their items/recipients'),
  ('docs.transmittal.create', 'docs', 'transmittal', 'create', 'Create a draft transmittal'),
  ('docs.transmittal.send', 'docs', 'transmittal', 'send', 'Send a draft transmittal to its recipients'),
  ('docs.approval_matrix.manage', 'docs', 'approval_matrix', 'manage', 'Define and update approval matrices')
ON CONFLICT (key) DO NOTHING;
