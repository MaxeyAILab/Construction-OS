-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_sso_connections_audit BEFORE INSERT OR UPDATE ON "sso_connections"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "sso_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sso_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sso_connections"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
