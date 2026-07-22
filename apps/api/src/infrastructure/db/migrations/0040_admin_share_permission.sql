-- Custom SQL migration file, put your code below! --

-- api.md §15: "GET/POST /admin/external-shares | admin.share.manage |
-- Client/sub/supplier grants (FR-RBAC-3)." Uses the `admin.*` prefix api.md
-- documents literally, even though the rest of today's RBAC endpoints still
-- live under the pre-rename `platform.*` prefix (see the already-flagged
-- follow-up to rename /rbac/* -> /admin/*, platform.* -> admin.* to match
-- api.md §15 in full) -- using the correct key now for a brand-new
-- permission is one less rename later, not one more inconsistency.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.share.manage', 'admin', 'share', 'manage', 'Grant/revoke client, subcontractor, and supplier record shares')
ON CONFLICT (key) DO NOTHING;
