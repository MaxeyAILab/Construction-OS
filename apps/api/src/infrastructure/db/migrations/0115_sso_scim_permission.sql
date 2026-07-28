-- Custom SQL migration file, put your code below! --

-- api.md §2.1 "Enterprise SSO (SAML) + SCIM provisioning" — one permission
-- gates connection admin (/sso/connections/*); SCIM's own endpoints are
-- authenticated by the connection's own bearer token, not this permission.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.sso.manage', 'admin', 'sso', 'manage', 'Configure enterprise SSO (SAML) connections and rotate SCIM tokens')
ON CONFLICT (key) DO NOTHING;
