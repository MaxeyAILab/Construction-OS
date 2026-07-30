-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_company_briefings_audit BEFORE INSERT OR UPDATE ON "company_briefings"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "company_briefings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "company_briefings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "company_briefings"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
