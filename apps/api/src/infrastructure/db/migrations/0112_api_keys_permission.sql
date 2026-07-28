-- Custom SQL migration file, put your code below! --

-- api.md §16.4: "Public API: API keys" — admin.apikey.manage gates all
-- three CRUD endpoints (GET/POST /api-keys, DELETE /api-keys/{id}). The
-- api_keys table itself (and its RLS policy) has existed since Phase 1A's
-- multitenant-core migration; this is only the permission-catalog seed
-- that was never added because the service/controller weren't built yet.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.apikey.manage', 'admin', 'apikey', 'manage', 'Create, list, and revoke server-to-server API keys')
ON CONFLICT (key) DO NOTHING;
