-- Custom SQL migration file, put your code below! --

-- api.md §15.3 / ai-spec.md §15 "Billing Agent". Same bootstrap problem,
-- same fix, as get_active_procurement_agents (0121): the Billing Agent's
-- monthly tick is a background job with no request-scoped tenant, so it
-- has no way to satisfy agent_identities' FORCE ROW LEVEL SECURITY to
-- even discover which tenants have an active Billing Agent to run.
-- SECURITY DEFINER narrowly bypasses RLS for exactly this one
-- enumeration step; only tenant_id + agent identifiers are returned (no
-- secret material), and every subsequent read/write the runner performs
-- goes back through the normal withTenant()-scoped path.
--
-- "Which agents are Billing Agents" is determined by tool_allowlist
-- containing 'assemble_and_route_pay_applications', same
-- capability-is-identity precedent as the Procurement Agent.
CREATE OR REPLACE FUNCTION get_active_billing_agents()
RETURNS TABLE (
  tenant_id uuid,
  agent_id uuid,
  agent_user_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT a.tenant_id, a.id, a.user_id
  FROM agent_identities a
  WHERE a.status = 'active'
    AND a.deleted_at IS NULL
    AND a.tool_allowlist @> ARRAY['assemble_and_route_pay_applications']::text[];
$$;
