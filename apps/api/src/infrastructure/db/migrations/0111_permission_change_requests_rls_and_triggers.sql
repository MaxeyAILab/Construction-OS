-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_permission_change_requests_audit BEFORE INSERT OR UPDATE ON "permission_change_requests"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "permission_change_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permission_change_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "permission_change_requests"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
