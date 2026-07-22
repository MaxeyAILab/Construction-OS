-- Custom SQL migration file, put your code below! --

-- M16 Executive Dashboard v1. No assign_tenant_audit_columns() trigger on
-- these tables (unlike every other tenant table this session) — they skip
-- tenantColumns() entirely (see dashboards.ts's schema comment: disposable
-- projections, upserted wholesale by the projections consumer, not
-- created/soft-deleted row by row). RLS still applies; multi-tenancy is
-- not optional just because a table is a rebuildable read model.

ALTER TABLE "projection_project_financials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projection_project_financials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "projection_project_financials"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "projection_company_kpis" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projection_company_kpis" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "projection_company_kpis"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);