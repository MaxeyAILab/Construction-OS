-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_client_selections_audit BEFORE INSERT OR UPDATE ON "client_selections"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_portal_messages_audit BEFORE INSERT OR UPDATE ON "portal_messages"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "client_selections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "client_selections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "client_selections"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "portal_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "portal_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "portal_messages"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
