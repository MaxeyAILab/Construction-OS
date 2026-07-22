-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_project_templates_audit BEFORE INSERT OR UPDATE ON "project_templates"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_projects_audit BEFORE INSERT OR UPDATE ON "projects"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_cost_codes_audit BEFORE INSERT OR UPDATE ON "cost_codes"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_project_users_audit BEFORE INSERT OR UPDATE ON "project_users"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_milestones_audit BEFORE INSERT OR UPDATE ON "milestones"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "project_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project_templates"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "projects"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "cost_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cost_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cost_codes"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "project_users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project_users"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "milestones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "milestones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "milestones"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "idempotency_keys"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
