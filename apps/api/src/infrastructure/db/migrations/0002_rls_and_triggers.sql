-- Custom SQL migration file, put your code below! --

-- Per-tenant cursor for updated_seq (database.md §3: "assigned from a
-- per-tenant sequence via trigger"). One row-lock per tenant per write is
-- the same contention cost whether this counter lives here or inline on
-- companies; keeping it separate avoids coupling tenant metadata writes to
-- every table's write path.
CREATE TABLE "tenant_sequences" (
	"tenant_id" uuid PRIMARY KEY REFERENCES "public"."companies"("id") ON DELETE CASCADE,
	"updated_seq" bigint NOT NULL DEFAULT 0
);
--> statement-breakpoint
ALTER TABLE "tenant_sequences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- FORCE is required on every tenant table: Postgres exempts the table OWNER
-- from RLS by default, and our own application role is that owner (it ran
-- these migrations) — without FORCE, RLS would silently no-op for exactly
-- the connection it's meant to constrain (database.md §2, NFR-14).
ALTER TABLE "tenant_sequences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_sequences"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Combines updated_at maintenance + per-tenant updated_seq assignment
-- (database.md §3) into a single BEFORE trigger so tenant tables only pay
-- for one trigger invocation per write.
CREATE OR REPLACE FUNCTION assign_tenant_audit_columns() RETURNS trigger AS $$
BEGIN
	NEW.updated_at = now();
	INSERT INTO tenant_sequences (tenant_id, updated_seq)
	VALUES (NEW.tenant_id, 1)
	ON CONFLICT (tenant_id) DO UPDATE SET updated_seq = tenant_sequences.updated_seq + 1
	RETURNING updated_seq INTO NEW.updated_seq;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON "companies"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON "users"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Tables with full standard columns (updated_at + updated_seq): assign on
-- both INSERT and UPDATE so updated_seq is populated from row creation.
CREATE TRIGGER trg_company_users_audit BEFORE INSERT OR UPDATE ON "company_users"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_external_shares_audit BEFORE INSERT OR UPDATE ON "external_shares"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_roles_audit BEFORE INSERT OR UPDATE ON "roles"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_user_roles_audit BEFORE INSERT OR UPDATE ON "user_roles"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_api_keys_audit BEFORE INSERT OR UPDATE ON "api_keys"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_sessions_audit BEFORE INSERT OR UPDATE ON "sessions"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_webhook_endpoints_audit BEFORE INSERT OR UPDATE ON "webhook_endpoints"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

-- Every tenant-owned table gets RLS enabled + FORCEd + the standard policy
-- (database.md §2). role_permissions and webhook_deliveries are lean/
-- append-only tables without updated_at/updated_seq, so RLS only, no trigger.
ALTER TABLE "company_users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "company_users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "company_users"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "external_shares" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "external_shares" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "external_shares"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roles"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "role_permissions"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "user_roles"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "api_keys"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_endpoints"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_deliveries"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
