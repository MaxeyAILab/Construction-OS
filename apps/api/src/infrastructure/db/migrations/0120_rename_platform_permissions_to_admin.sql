-- Custom SQL migration file, put your code below! --

-- Flagged follow-up (api.md §15): the earliest RBAC endpoints seeded their
-- permission catalog under a `platform.*` key prefix before api.md's §15
-- convention was written down as `admin.*` (AuditController's
-- admin.audit.read and ExternalSharesController's admin.share.manage
-- already follow it — see their doc comments). This migration renames the
-- remaining `platform.*` keys to `admin.*` to match.
--
-- role_permissions.permission_key has a FK to permissions.key with no
-- ON UPDATE CASCADE, so the rename goes: insert the new admin.* rows,
-- repoint role_permissions at them, then drop the old platform.* rows
-- (by then unreferenced). permission_change_requests.payload may hold a
-- historical platform.* permissionKey in a pending grant/revoke request's
-- jsonb — left as-is (immutable-ish audit trail of what was requested,
-- and any pending request predates this migration in a dev-only database).

INSERT INTO permissions (key, module, resource, action, description, created_at)
SELECT 'admin.' || substring(key from 10), 'admin', resource, action, description, created_at
FROM permissions
WHERE key LIKE 'platform.%'
ON CONFLICT (key) DO NOTHING;

UPDATE role_permissions
SET permission_key = 'admin.' || substring(permission_key from 10)
WHERE permission_key LIKE 'platform.%';

DELETE FROM permissions WHERE key LIKE 'platform.%';
