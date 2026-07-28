-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_accounting_connections_audit BEFORE INSERT OR UPDATE ON "accounting_connections"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "accounting_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_connections"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_accounting_links_audit BEFORE INSERT OR UPDATE ON "accounting_links"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "accounting_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_links"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_accounting_sync_runs_audit BEFORE INSERT OR UPDATE ON "accounting_sync_runs"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "accounting_sync_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting_sync_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_sync_runs"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_accounting_sync_conflicts_audit BEFORE INSERT OR UPDATE ON "accounting_sync_conflicts"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "accounting_sync_conflicts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting_sync_conflicts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_sync_conflicts"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
