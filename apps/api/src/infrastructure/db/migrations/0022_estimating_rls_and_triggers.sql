-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_cost_items_audit BEFORE INSERT OR UPDATE ON "cost_items"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_cost_item_price_history_audit BEFORE INSERT OR UPDATE ON "cost_item_price_history"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_assemblies_audit BEFORE INSERT OR UPDATE ON "assemblies"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_assembly_items_audit BEFORE INSERT OR UPDATE ON "assembly_items"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_estimates_audit BEFORE INSERT OR UPDATE ON "estimates"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_estimate_lines_audit BEFORE INSERT OR UPDATE ON "estimate_lines"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "cost_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cost_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cost_items"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "cost_item_price_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cost_item_price_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cost_item_price_history"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "assemblies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assemblies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assemblies"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "assembly_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assembly_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assembly_items"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "estimates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "estimates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "estimates"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "estimate_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "estimate_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "estimate_lines"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
