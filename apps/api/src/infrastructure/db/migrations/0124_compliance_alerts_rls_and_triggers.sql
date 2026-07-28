-- Custom SQL migration file, put your code below! --

-- FR-SUB-2 / FR-SAFE-2 (api.md §15.4 "Compliance Agent"). compliance_alerts
-- has no tenantColumns()/assign_tenant_audit_columns() trigger — same
-- "manages its own timestamps" precedent as finance_alerts/ai_runs.

ALTER TABLE "compliance_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance_alerts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "compliance_alerts"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- A fired alert is a permanent record of what was flagged and when — same
-- "audit_log-shaped, reject every mutation" immutability as
-- reject_finance_alerts_mutation: a renewed certification's next read
-- simply stops reporting it as due, it never retracts this row.
CREATE OR REPLACE FUNCTION reject_compliance_alerts_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'compliance_alerts is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_compliance_alerts_immutable
	BEFORE UPDATE OR DELETE ON "compliance_alerts"
	FOR EACH ROW EXECUTE FUNCTION reject_compliance_alerts_mutation();
