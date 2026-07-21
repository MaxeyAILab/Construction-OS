-- Test/dev fixture only — not a migration, never applied to real environments.
--
-- Docker's default postgres:16 image bootstraps its "postgres" role as an
-- actual superuser, which unconditionally bypasses RLS (FORCE or not). That
-- masks bugs: it would let a cross-tenant isolation test pass for the wrong
-- reason. Supabase's default "postgres" role is deliberately NOT a
-- superuser, so this fixture creates an equivalent non-superuser role and
-- makes it the OWNER of every table (matching what actually happens on
-- Supabase — whichever role runs the migration owns the tables), so tests
-- run against the same FORCE ROW LEVEL SECURITY behavior production will see.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'constructionos_app') THEN
    CREATE ROLE constructionos_app LOGIN PASSWORD 'constructionos_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT ALL ON SCHEMA public TO constructionos_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO constructionos_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO constructionos_app;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO constructionos_app', r.tablename);
  END LOOP;
END
$$;
