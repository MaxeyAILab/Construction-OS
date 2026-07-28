-- Custom SQL migration file, put your code below! --

-- api.md §16.3: "GET/POST/PATCH/DELETE /webhooks | Endpoint CRUD ... GET
-- /webhooks/{id}/deliveries | Attempt log ... POST /webhooks/{id}/test."
-- No permission column shown for this section (unlike most api.md tables),
-- but a registered endpoint receives every subscribed company event —
-- clearly a privileged, company-wide admin capability, not a self-scoped
-- action like the Sync API's own unspecified-permission rows
-- (@Authenticated() only). Same "single permission for a whole endpoint
-- group" precedent as admin.integration.manage.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.webhook.manage', 'admin', 'webhook', 'manage', 'Register/manage outbound webhook endpoints, view delivery logs, send test events')
ON CONFLICT (key) DO NOTHING;
