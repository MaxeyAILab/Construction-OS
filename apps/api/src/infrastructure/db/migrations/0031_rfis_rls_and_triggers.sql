-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_rfis_audit BEFORE INSERT OR UPDATE ON "rfis"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "rfis" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rfis" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rfis"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
