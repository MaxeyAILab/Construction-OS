-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_files_audit BEFORE INSERT OR UPDATE ON "files"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "files"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
