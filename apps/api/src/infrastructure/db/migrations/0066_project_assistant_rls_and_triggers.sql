-- Custom SQL migration file, put your code below! --

-- M17 Project Assistant (ai-spec.md §7.2, database.md §19). No
-- assign_tenant_audit_columns() trigger on either table — same
-- "tenantColumns() skipped entirely" precedent as ai_runs/ai_budgets —
-- ai_conversations and ai_messages manage their own timestamps.

ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_conversations"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_messages"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- database.md §19: messages are a permanent record of what was asked and
-- answered — same "audit_log-shaped, reject every mutation" immutability
-- as audit_log itself (reject_audit_log_mutation), simpler than ai_runs'
-- variant since there's no analogous single mutable column here (no
-- 'outcome'-style post-hoc field on a message).
CREATE OR REPLACE FUNCTION reject_ai_messages_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'ai_messages is append-only: UPDATE/DELETE are not permitted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_ai_messages_immutable
	BEFORE UPDATE OR DELETE ON "ai_messages"
	FOR EACH ROW EXECUTE FUNCTION reject_ai_messages_mutation();
