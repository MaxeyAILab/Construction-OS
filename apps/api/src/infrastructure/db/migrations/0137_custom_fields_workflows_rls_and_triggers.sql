-- Custom SQL migration file, put your code below! --

-- database.md §24 (FR-PLAT-11/12). All three tables are ordinary
-- tenantColumns() tables — audit trigger + RLS, same shape as every other
-- module.

CREATE TRIGGER trg_custom_field_definitions_audit BEFORE INSERT OR UPDATE ON "custom_field_definitions"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_field_definitions"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_custom_field_values_audit BEFORE INSERT OR UPDATE ON "custom_field_values"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_field_values"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_custom_field_automations_audit BEFORE INSERT OR UPDATE ON "custom_field_automations"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "custom_field_automations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_field_automations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_field_automations"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
