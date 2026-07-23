-- Custom SQL migration file, put your code below! --

-- M11 Equipment & Asset Management. Standard tenantColumns() tables — RLS
-- + audit-column trigger, same shape as every other module's own
-- rls_and_triggers migration.

CREATE TRIGGER trg_equipment_audit BEFORE INSERT OR UPDATE ON "equipment"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "equipment" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_equipment_assignments_audit BEFORE INSERT OR UPDATE ON "equipment_assignments"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "equipment_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "equipment_assignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment_assignments"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_equipment_usage_logs_audit BEFORE INSERT OR UPDATE ON "equipment_usage_logs"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "equipment_usage_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "equipment_usage_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment_usage_logs"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_maintenance_schedules_audit BEFORE INSERT OR UPDATE ON "maintenance_schedules"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "maintenance_schedules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "maintenance_schedules"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_maintenance_work_orders_audit BEFORE INSERT OR UPDATE ON "maintenance_work_orders"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "maintenance_work_orders"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_equipment_inspections_audit BEFORE INSERT OR UPDATE ON "equipment_inspections"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "equipment_inspections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "equipment_inspections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment_inspections"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- FR-EQ-1: "Exclusion constraint (EXCLUDE USING gist on equipment_id +
-- tstzrange) prevents double-assignment — DB-level guarantee." Requires
-- btree_gist for a uuid equality operator class inside a gist index (the
-- built-in uuid btree opclass alone can't participate in a gist index).
-- open-ended assignments (end_at IS NULL) are treated as extending to
-- 'infinity' so an ongoing assignment still conflicts with any later
-- overlapping one.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "ck_equipment_assignments_no_overlap"
	EXCLUDE USING gist (
		"equipment_id" WITH =,
		tstzrange("start_at", coalesce("end_at", 'infinity'::timestamptz)) WITH &&
	);