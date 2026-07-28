-- Custom SQL migration file, put your code below! --

-- api.md §15.2 / ai-spec.md §15 "Procurement Agent". Same bootstrap
-- problem as outbox_claim_pending_events (0006) and
-- get_sso_connection_for_login (0116): the Procurement Agent's daily tick
-- (ProcurementAgentRunnerService) is a background job with no
-- request-scoped tenant, so it has no way to satisfy agent_identities'
-- FORCE ROW LEVEL SECURITY to even discover which tenants have an active
-- Procurement Agent to run. SECURITY DEFINER narrowly bypasses RLS for
-- exactly this one enumeration step; only tenant_id + agent identifiers
-- are returned (no secret material), and every subsequent read/write the
-- runner performs goes back through the normal withTenant()-scoped path.
--
-- "Which agents are Procurement Agents" is determined by tool_allowlist
-- containing 'draft_and_route_purchase_orders' rather than a new
-- agent-type column — an agent's declared capabilities already are its
-- identity (ai-spec.md §15: "Agent = declared identity: {..., tool
-- allowlist, ...}").
CREATE OR REPLACE FUNCTION get_active_procurement_agents()
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
    AND a.tool_allowlist @> ARRAY['draft_and_route_purchase_orders']::text[];
$$;