-- Custom SQL migration file, put your code below! --

-- M6 Mobile Sync (architecture.md §14.2, NFR-10/11/12). No
-- assign_tenant_audit_columns() trigger — sync_mutations skips
-- tenantColumns() entirely (see sync.ts's schema comment).

ALTER TABLE "sync_mutations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sync_mutations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_mutations"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);