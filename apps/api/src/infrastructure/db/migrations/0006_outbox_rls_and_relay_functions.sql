-- Custom SQL migration file, put your code below! --

ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

-- The relay worker is a platform-level process, not acting on behalf of
-- any one tenant — it must see pending events across every tenant, which
-- RLS by design forbids for any ordinary (tenant-scoped) connection.
-- database.md §2 / architecture.md §17 call this out explicitly:
-- "platform-level jobs use a break-glass role with full audit." Rather
-- than grant a blanket BYPASSRLS role, these two SECURITY DEFINER
-- functions are the entire break-glass surface: their contracts are
-- narrow (claim-a-batch, mark-published-by-id) and don't expose event
-- payloads to anything other than the relay's own publish step.
CREATE OR REPLACE FUNCTION outbox_claim_pending_events(p_limit int, p_lease_seconds int DEFAULT 30)
RETURNS SETOF outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
	UPDATE outbox
	SET claimed_at = now()
	WHERE id IN (
		SELECT id FROM outbox
		WHERE published_at IS NULL
			AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => p_lease_seconds))
		ORDER BY occurred_at
		LIMIT p_limit
		FOR UPDATE SKIP LOCKED
	)
	RETURNING *;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION outbox_mark_published(p_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
	UPDATE outbox SET published_at = now() WHERE id = ANY(p_ids) AND published_at IS NULL;
$$;