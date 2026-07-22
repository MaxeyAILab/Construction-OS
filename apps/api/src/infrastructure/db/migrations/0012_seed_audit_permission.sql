-- Custom SQL migration file, put your code below! --

-- api.md §15 documents this specific endpoint under the "admin" module
-- namespace (admin.audit.read, GET /admin/audit-log) rather than the
-- "platform" namespace 0004_seed_permissions.sql used for the earlier
-- RBAC endpoints — a pre-existing naming mismatch tracked separately
-- (see the flagged rename follow-up). This migration follows api.md
-- exactly for this new permission rather than compounding the drift.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.audit.read', 'admin', 'audit', 'read', 'Read the immutable audit log')
ON CONFLICT (key) DO NOTHING;