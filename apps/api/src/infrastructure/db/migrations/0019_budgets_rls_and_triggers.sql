-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_budgets_audit BEFORE INSERT OR UPDATE ON "budgets"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_budget_lines_audit BEFORE INSERT OR UPDATE ON "budget_lines"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_commitments_audit BEFORE INSERT OR UPDATE ON "commitments"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_cost_transactions_audit BEFORE INSERT OR UPDATE ON "cost_transactions"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "budgets"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "budget_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budget_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "budget_lines"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "commitments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commitments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "commitments"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "cost_transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cost_transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cost_transactions"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
