-- Custom SQL migration file, put your code below! --

-- ai-spec.md §7.6 (Equipment AI) / FR-EQ-4 "fault patterns". Same
-- "manages its own timestamps, no tenantColumns()" precedent as
-- compliance_alerts/finance_alerts.

ALTER TABLE "equipment_fault_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "equipment_fault_alerts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment_fault_alerts"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- A fired alert is a permanent record of what the AI flagged and why —
-- same "audit_log-shaped, reject every mutation" immutability as
-- reject_compliance_alerts_mutation/reject_finance_alerts_mutation: a
-- subsequent new failure produces a new row, it never edits this one.
CREATE OR REPLACE FUNCTION reject_equipment_fault_alerts_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'equipment_fault_alerts is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_equipment_fault_alerts_immutable
	BEFORE UPDATE OR DELETE ON "equipment_fault_alerts"
	FOR EACH ROW EXECUTE FUNCTION reject_equipment_fault_alerts_mutation();
