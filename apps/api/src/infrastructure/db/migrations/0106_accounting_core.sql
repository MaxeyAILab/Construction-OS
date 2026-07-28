CREATE TABLE "accounting_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"realm_id" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"mapping" jsonb,
	"last_synced_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "ck_accounting_connections_provider" CHECK ("accounting_connections"."provider" in ('quickbooks', 'sage', 'xero')),
	CONSTRAINT "ck_accounting_connections_status" CHECK ("accounting_connections"."status" in ('pending', 'connected', 'disconnected', 'error'))
);
--> statement-breakpoint
CREATE TABLE "accounting_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"sync_state" jsonb,
	CONSTRAINT "ck_accounting_links_provider" CHECK ("accounting_links"."provider" in ('quickbooks', 'sage', 'xero')),
	CONSTRAINT "ck_accounting_links_entity_type" CHECK ("accounting_links"."entity_type" in ('cost_transaction'))
);
--> statement-breakpoint
CREATE TABLE "accounting_sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"local_value" jsonb NOT NULL,
	"remote_value" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "ck_accounting_sync_conflicts_entity_type" CHECK ("accounting_sync_conflicts"."entity_type" in ('cost_transaction')),
	CONSTRAINT "ck_accounting_sync_conflicts_status" CHECK ("accounting_sync_conflicts"."status" in ('open', 'resolved_local', 'resolved_remote'))
);
--> statement-breakpoint
CREATE TABLE "accounting_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"pushed_count" integer DEFAULT 0 NOT NULL,
	"pulled_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "ck_accounting_sync_runs_provider" CHECK ("accounting_sync_runs"."provider" in ('quickbooks', 'sage', 'xero')),
	CONSTRAINT "ck_accounting_sync_runs_status" CHECK ("accounting_sync_runs"."status" in ('queued', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "accounting_connections" ADD CONSTRAINT "accounting_connections_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_connections" ADD CONSTRAINT "accounting_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_connections" ADD CONSTRAINT "accounting_connections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_links" ADD CONSTRAINT "accounting_links_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_links" ADD CONSTRAINT "accounting_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_links" ADD CONSTRAINT "accounting_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_conflicts" ADD CONSTRAINT "accounting_sync_conflicts_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_conflicts" ADD CONSTRAINT "accounting_sync_conflicts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_conflicts" ADD CONSTRAINT "accounting_sync_conflicts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_conflicts" ADD CONSTRAINT "accounting_sync_conflicts_sync_run_id_accounting_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."accounting_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_conflicts" ADD CONSTRAINT "accounting_sync_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_runs" ADD CONSTRAINT "accounting_sync_runs_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_runs" ADD CONSTRAINT "accounting_sync_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_runs" ADD CONSTRAINT "accounting_sync_runs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sync_runs" ADD CONSTRAINT "accounting_sync_runs_connection_id_accounting_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."accounting_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_accounting_connections_tenant_provider" ON "accounting_connections" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_accounting_links_tenant_provider_entity_external" ON "accounting_links" USING btree ("tenant_id","provider","entity_type","external_id");--> statement-breakpoint
CREATE INDEX "ix_accounting_links_entity" ON "accounting_links" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ix_accounting_sync_conflicts_tenant_status" ON "accounting_sync_conflicts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "ix_accounting_sync_runs_tenant_connection" ON "accounting_sync_runs" USING btree ("tenant_id","connection_id");