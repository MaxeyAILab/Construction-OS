-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_resource_assignments_audit BEFORE INSERT OR UPDATE ON "resource_assignments"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "resource_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "resource_assignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "resource_assignments"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- FR-SCH-5 (database.md §14): "overlap queries via gist index (conflict
-- surfacing)" — a plain query-support index, NOT an exclusion constraint:
-- unlike equipment_assignments' hard double-booking block, a schedule
-- resource booking may legitimately overlap (a PM tentatively double-books
-- a crew before deciding which activity wins); ResourceConflictsService
-- reads through this index to surface those overlaps rather than the
-- database rejecting them outright. Requires btree_gist for the
-- tenant_id/resource_key equality operators to participate in a GIST index
-- alongside the range operator.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE INDEX "ix_resource_assignments_conflict_gist" ON "resource_assignments"
	USING gist (
		"tenant_id",
		"resource_key",
		tstzrange("start_at", "end_at", '[)')
	);