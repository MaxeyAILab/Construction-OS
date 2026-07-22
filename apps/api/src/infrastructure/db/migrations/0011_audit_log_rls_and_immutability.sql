-- Custom SQL migration file, put your code below! --

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- database.md §6: "Immutability: INSERT-only role; no UPDATE/DELETE
-- grants." A plain REVOKE UPDATE/DELETE can't actually enforce that here:
-- whichever role runs migrations OWNS this table (same as every other
-- tenant table — database.md §2's "whichever role runs the migration owns
-- the tables"), and table owners always retain full DML rights in
-- Postgres regardless of REVOKE — the same gotcha as RLS needing FORCE to
-- bind the owner (0002_rls_and_triggers.sql). A BEFORE trigger that
-- unconditionally rejects UPDATE/DELETE is the one mechanism that holds
-- even against the owning role.
CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_audit_log_immutable
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();