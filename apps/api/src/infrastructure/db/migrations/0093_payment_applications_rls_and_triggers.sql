-- Custom SQL migration file, put your code below! --

-- Payment Applications (FR-FIN-4). Standard tenantColumns() tables —
-- RLS + audit-column trigger, same shape as every other module's own
-- rls_and_triggers migration.

CREATE TRIGGER trg_payment_applications_audit BEFORE INSERT OR UPDATE ON "payment_applications"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "payment_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_applications"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_payment_application_lines_audit BEFORE INSERT OR UPDATE ON "payment_application_lines"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "payment_application_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_application_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_application_lines"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
