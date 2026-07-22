-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_change_orders_audit BEFORE INSERT OR UPDATE ON "change_orders"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_change_order_lines_audit BEFORE INSERT OR UPDATE ON "change_order_lines"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "change_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "change_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "change_orders"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "change_order_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "change_order_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "change_order_lines"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
