-- Custom SQL migration file, put your code below! --

-- M17 AI Gateway (ai-spec.md §2, database.md §19). No
-- assign_tenant_audit_columns() trigger on either table — same
-- "tenantColumns() skipped entirely" precedent as sync_mutations/
-- audit_log — ai_runs and ai_budgets manage their own timestamps.

ALTER TABLE "ai_budgets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_budgets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_budgets"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_runs"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- database.md §19 / ai-spec.md §12: ai_runs is append-only except for one
-- thing — `outcome` transitions as the consuming product surface observes
-- what the user did with the output (shown -> accepted/rejected/
-- auto_applied/escalated). Unlike audit_log's "reject every mutation"
-- trigger, this one allows an UPDATE that changes only `outcome` and
-- rejects everything else (including DELETE), so the metering/audit trail
-- itself can never be edited or backdated.
CREATE OR REPLACE FUNCTION reject_ai_runs_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'ai_runs is append-only: DELETE is not permitted';
	END IF;

	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
		OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
		OR NEW.purpose IS DISTINCT FROM OLD.purpose
		OR NEW.prompt_template_id IS DISTINCT FROM OLD.prompt_template_id
		OR NEW.model IS DISTINCT FROM OLD.model
		OR NEW.input_tokens IS DISTINCT FROM OLD.input_tokens
		OR NEW.output_tokens IS DISTINCT FROM OLD.output_tokens
		OR NEW.cost_usd IS DISTINCT FROM OLD.cost_usd
		OR NEW.latency_ms IS DISTINCT FROM OLD.latency_ms
		OR NEW.confidence IS DISTINCT FROM OLD.confidence
		OR NEW.sources IS DISTINCT FROM OLD.sources
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
	THEN
		RAISE EXCEPTION 'ai_runs rows are immutable except outcome';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_ai_runs_immutable
	BEFORE UPDATE OR DELETE ON "ai_runs"
	FOR EACH ROW EXECUTE FUNCTION reject_ai_runs_mutation();
