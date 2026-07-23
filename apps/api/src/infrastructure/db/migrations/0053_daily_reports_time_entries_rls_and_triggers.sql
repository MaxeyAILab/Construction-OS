-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_daily_reports_audit BEFORE INSERT OR UPDATE ON "daily_reports"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_time_entries_audit BEFORE INSERT OR UPDATE ON "time_entries"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "daily_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "daily_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "daily_reports"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "time_entries"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
