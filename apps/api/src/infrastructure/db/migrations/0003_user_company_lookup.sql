-- Custom SQL migration file, put your code below! --

-- Bootstrap problem: company_users is RLS'd per tenant_id, but "which
-- companies does this user belong to" is inherently cross-tenant — it's the
-- very first thing login needs, before any tenant context exists to set.
-- SECURITY DEFINER narrowly bypasses RLS for exactly this one query shape:
-- the caller-supplied user_id is the only filter, so it can never return
-- another user's memberships, let alone unrelated tenant data. Left
-- PUBLIC-executable (the Postgres default) since every app connection
-- legitimately needs to ask this for every user — restricting EXECUTE to a
-- named role would also hardcode a role name that doesn't exist until
-- whichever environment (e.g. Supabase) provisions its own.
CREATE OR REPLACE FUNCTION get_user_company_memberships(p_user_id uuid)
RETURNS TABLE (company_id uuid, company_name text, company_slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.name, c.slug
  FROM company_users cu
  JOIN companies c ON c.id = cu.tenant_id
  WHERE cu.user_id = p_user_id
    AND cu.deleted_at IS NULL
    AND cu.status = 'active';
$$;