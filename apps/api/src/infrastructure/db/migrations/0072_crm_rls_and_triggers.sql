-- Custom SQL migration file, put your code below! --

-- M1 CRM & Pre-Construction. Standard tenantColumns() tables — RLS +
-- audit-column trigger, same shape as every other module's own
-- rls_and_triggers migration.

CREATE TRIGGER trg_contact_companies_audit BEFORE INSERT OR UPDATE ON "contact_companies"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "contact_companies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contact_companies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contact_companies"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_contacts_audit BEFORE INSERT OR UPDATE ON "contacts"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_pipeline_stages_audit BEFORE INSERT OR UPDATE ON "pipeline_stages"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pipeline_stages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pipeline_stages"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_opportunities_audit BEFORE INSERT OR UPDATE ON "opportunities"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "opportunities"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_activities_audit BEFORE INSERT OR UPDATE ON "activities"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "activities"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- Closes the dormant gap projects.client_contact_company_id's own schema
-- comment flagged since the Projects row: CRM (M1) now exists. Added here
-- as a hand-written statement rather than a drizzle `.references()` call
-- on the projects.ts column — crm.ts already imports projects.ts
-- (opportunities.won_project_id), so the reverse import would be a
-- circular module dependency between the two schema files.
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_contact_company_id_contact_companies_id_fk"
	FOREIGN KEY ("client_contact_company_id") REFERENCES "public"."contact_companies"("id");