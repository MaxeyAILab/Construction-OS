-- Custom SQL migration file, put your code below! --

-- M12 Safety & Compliance. Standard tenantColumns() tables — RLS + audit-
-- column trigger, same shape as every other module's own rls_and_triggers
-- migration.

CREATE TRIGGER trg_safety_form_templates_audit BEFORE INSERT OR UPDATE ON "safety_form_templates"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "safety_form_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "safety_form_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "safety_form_templates"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_safety_forms_audit BEFORE INSERT OR UPDATE ON "safety_forms"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "safety_forms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "safety_forms" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "safety_forms"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_incidents_audit BEFORE INSERT OR UPDATE ON "incidents"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "incidents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "incidents"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_certifications_audit BEFORE INSERT OR UPDATE ON "certifications"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "certifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "certifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "certifications"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
