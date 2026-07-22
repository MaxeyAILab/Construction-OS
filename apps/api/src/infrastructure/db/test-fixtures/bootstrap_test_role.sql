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
--
-- Every spec file's beforeAll() runs this fixture, and vitest runs spec
-- files concurrently against the same real Postgres instance. GRANT and
-- ALTER TABLE OWNER both write to system catalogs (pg_class.relacl,
-- pg_namespace.nspacl) even when the privilege/owner is already correct —
-- Postgres doesn't skip the write just because it's a no-op — so two
-- concurrent sessions both running them raises "tuple concurrently
-- updated". Gating the whole grant/ALTER block behind "is there still a
-- table not owned by constructionos_app" makes every bootstrap call after
-- the first a pure read-only no-op, which is what actually avoids the
-- race (a lock was tried first; its release-on-error semantics proved
-- worse — a connection erroring mid-script without reaching an explicit
-- unlock left other sessions blocked until it fully tore down).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'constructionos_app') THEN
    CREATE ROLE constructionos_app LOGIN PASSWORD 'constructionos_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'constructionos_app'
  ) THEN
    EXECUTE 'GRANT ALL ON SCHEMA public TO constructionos_app';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA public TO constructionos_app';
    EXECUTE 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO constructionos_app';

    FOR r IN
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tableowner <> 'constructionos_app'
    LOOP
      EXECUTE format('ALTER TABLE public.%I OWNER TO constructionos_app', r.tablename);
    END LOOP;
  END IF;
END
$$;
