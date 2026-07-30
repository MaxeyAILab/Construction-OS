-- Custom SQL migration file, put your code below! --

-- api.md §15.6 "Executive Briefing Agent" (ai-spec.md §7.1: "weekly
-- proactive briefing (notification + portal card)"). Same bootstrap
-- problem, same fix, as get_active_procurement_agents (0121), get_active_
-- billing_agents (0122), get_active_compliance_agents (0125), and
-- get_active_closeout_agents (0129): the Executive Briefing Agent's weekly
-- tick is a background job with no request-scoped tenant, so it has no way
-- to satisfy agent_identities' FORCE ROW LEVEL SECURITY to even discover
-- which tenants have an active Executive Briefing Agent to run.
-- SECURITY DEFINER narrowly bypasses RLS for exactly this one enumeration
-- step; only tenant_id + agent identifiers are returned (no secret
-- material), and every subsequent read/write the runner performs goes back
-- through the normal withTenant()-scoped path.
--
-- "Which agents are Executive Briefing Agents" is determined by
-- tool_allowlist containing 'generate_executive_briefing', same
-- capability-is-identity precedent as the other four agents.
CREATE OR REPLACE FUNCTION get_active_executive_briefing_agents()
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
    AND a.tool_allowlist @> ARRAY['generate_executive_briefing']::text[];
$$;
