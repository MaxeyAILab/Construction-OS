-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_tasks_audit BEFORE INSERT OR UPDATE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_comments_audit BEFORE INSERT OR UPDATE ON "comments"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tasks"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "comments"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
