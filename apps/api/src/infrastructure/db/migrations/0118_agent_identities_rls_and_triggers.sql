-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_agent_identities_audit BEFORE INSERT OR UPDATE ON "agent_identities"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "agent_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_identities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agent_identities"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- api.md §15.1: "An agent is a users row... with company_users.kind =
-- 'agent'" — 'agent' joins 'internal'/'external' (0026's Client Portal
-- migration) as a third principal-classification value on the same
-- column, not a new column or table.
ALTER TABLE "company_users" DROP CONSTRAINT IF EXISTS "ck_company_users_kind";
--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "ck_company_users_kind" CHECK ("kind" in ('internal', 'external', 'agent'));
