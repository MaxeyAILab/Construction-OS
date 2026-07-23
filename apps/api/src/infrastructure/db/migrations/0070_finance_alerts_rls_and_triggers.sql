-- Custom SQL migration file, put your code below! --

-- FR-FIN-6 (database.md finance domain). finance_alerts has no
-- tenantColumns()/assign_tenant_audit_columns() trigger — same "manages
-- its own timestamps" precedent as ai_runs/ai_conversations/ai_messages.

ALTER TABLE "finance_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "finance_alerts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "finance_alerts"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- A fired alert is a permanent record of what was flagged and when — same
-- "audit_log-shaped, reject every mutation" immutability as ai_messages
-- (reject_ai_messages_mutation): a recovered or worsened margin produces a
-- new row via MarginErosionService, never an edit to this one.
CREATE OR REPLACE FUNCTION reject_finance_alerts_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'finance_alerts is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_finance_alerts_immutable
	BEFORE UPDATE OR DELETE ON "finance_alerts"
	FOR EACH ROW EXECUTE FUNCTION reject_finance_alerts_mutation();