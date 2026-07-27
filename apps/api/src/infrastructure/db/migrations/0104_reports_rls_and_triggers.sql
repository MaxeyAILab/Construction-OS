-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_report_definitions_audit BEFORE INSERT OR UPDATE ON "report_definitions"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "report_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_definitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_definitions"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_report_runs_audit BEFORE INSERT OR UPDATE ON "report_runs"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "report_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_runs"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
