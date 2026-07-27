-- Custom SQL migration file, put your code below! --

-- Supplier Portal (M15) + Finance invoices/invoice_lines/payments
-- (database.md §11, FR-VEND-2, FR-SUB-3 gap closure). Standard
-- tenantColumns() tables — RLS + audit-column trigger, same shape as
-- every other module's own rls_and_triggers migration.

CREATE TRIGGER trg_invoices_audit BEFORE INSERT OR UPDATE ON "invoices"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoices"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_invoice_lines_audit BEFORE INSERT OR UPDATE ON "invoice_lines"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_lines"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_payments_audit BEFORE INSERT OR UPDATE ON "payments"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
