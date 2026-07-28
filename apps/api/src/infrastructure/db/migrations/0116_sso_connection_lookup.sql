-- Custom SQL migration file, put your code below! --

-- Same bootstrap problem as get_user_company_memberships (0003): the SAML
-- login/ACS/metadata endpoints only ever learn a bare connection id (from
-- the URL the tenant pasted into its IdP's app config) — there is no
-- tenant context yet to satisfy sso_connections' FORCE ROW LEVEL SECURITY.
-- SECURITY DEFINER narrowly bypasses RLS for exactly this one query shape:
-- the caller-supplied connection id is the only filter, so it can never
-- return another connection's config, and no secret material (scim_token_
-- hash) is exposed by this function's return columns.
CREATE OR REPLACE FUNCTION get_sso_connection_for_login(p_connection_id uuid)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  idp_entity_id text,
  idp_sso_url text,
  idp_certificate text,
  default_role_id uuid,
  attribute_mapping jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.tenant_id, c.idp_entity_id, c.idp_sso_url, c.idp_certificate, c.default_role_id, c.attribute_mapping
  FROM sso_connections c
  WHERE c.id = p_connection_id
    AND c.is_active = true
    AND c.deleted_at IS NULL;
$$;
