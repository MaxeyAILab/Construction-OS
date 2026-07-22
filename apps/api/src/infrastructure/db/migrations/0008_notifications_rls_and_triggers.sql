-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_notifications_audit BEFORE INSERT OR UPDATE ON "notifications"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_notification_preferences_audit BEFORE INSERT OR UPDATE ON "notification_preferences"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_push_devices_audit BEFORE INSERT OR UPDATE ON "push_devices"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_preferences"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "push_devices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "push_devices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "push_devices"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);