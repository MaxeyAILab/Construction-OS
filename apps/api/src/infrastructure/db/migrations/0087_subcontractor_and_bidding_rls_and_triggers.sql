-- Custom SQL migration file, put your code below! --

-- M14 Subcontractor Management + Estimating's FR-EST-6 bidding tables.
-- Standard tenantColumns() tables — RLS + audit-column trigger, same
-- shape as every other module's own rls_and_triggers migration.

CREATE TRIGGER trg_subcontractors_audit BEFORE INSERT OR UPDATE ON "subcontractors"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "subcontractors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subcontractors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subcontractors"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_subcontracts_audit BEFORE INSERT OR UPDATE ON "subcontracts"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "subcontracts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subcontracts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subcontracts"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_subcontract_lines_audit BEFORE INSERT OR UPDATE ON "subcontract_lines"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "subcontract_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subcontract_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subcontract_lines"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_bid_packages_audit BEFORE INSERT OR UPDATE ON "bid_packages"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "bid_packages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bid_packages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bid_packages"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_bid_invitations_audit BEFORE INSERT OR UPDATE ON "bid_invitations"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "bid_invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bid_invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bid_invitations"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_bids_audit BEFORE INSERT OR UPDATE ON "bids"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "bids" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bids" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bids"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);