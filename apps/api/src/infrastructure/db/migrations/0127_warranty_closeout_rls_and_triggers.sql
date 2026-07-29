-- Custom SQL migration file, put your code below! --

-- database.md §23 / spec.md §13.18 (M19). closeout_checklist_items and
-- warranties/warranty_claims are ordinary tenantColumns() tables — audit
-- trigger + RLS, same shape as every other module.

CREATE TRIGGER trg_closeout_checklist_items_audit BEFORE INSERT OR UPDATE ON "closeout_checklist_items"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "closeout_checklist_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "closeout_checklist_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "closeout_checklist_items"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_warranties_audit BEFORE INSERT OR UPDATE ON "warranties"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "warranties" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warranties" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "warranties"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_warranty_claims_audit BEFORE INSERT OR UPDATE ON "warranty_claims"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "warranty_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warranty_claims" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "warranty_claims"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- closeout_packages has no tenantColumns()/audit trigger — same "manages
-- its own timestamps" precedent as finance_alerts/compliance_alerts: one
-- row per assembly attempt is a permanent record of what was bundled and
-- when, never edited (a re-assembly produces a new row).

ALTER TABLE "closeout_packages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "closeout_packages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "closeout_packages"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_closeout_packages_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'closeout_packages is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_closeout_packages_immutable
	BEFORE UPDATE OR DELETE ON "closeout_packages"
	FOR EACH ROW EXECUTE FUNCTION reject_closeout_packages_mutation();
