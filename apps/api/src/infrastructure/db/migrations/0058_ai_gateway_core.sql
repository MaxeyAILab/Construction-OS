CREATE TABLE "ai_budgets" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"monthly_limit_usd" numeric(10, 2) DEFAULT '50.00' NOT NULL,
	"soft_limit_ratio" numeric(3, 2) DEFAULT '0.80' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"purpose" text NOT NULL,
	"prompt_template_id" text,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"latency_ms" integer NOT NULL,
	"confidence" numeric(3, 2),
	"sources" jsonb,
	"outcome" text DEFAULT 'shown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ai_runs_outcome" CHECK ("ai_runs"."outcome" in ('shown', 'accepted', 'rejected', 'auto_applied', 'escalated', 'error')),
	CONSTRAINT "ck_ai_runs_confidence_range" CHECK ("ai_runs"."confidence" is null or ("ai_runs"."confidence" >= 0 and "ai_runs"."confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "ai_budgets" ADD CONSTRAINT "ai_budgets_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_ai_runs_tenant_created" ON "ai_runs" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_ai_runs_tenant_purpose_created" ON "ai_runs" USING btree ("tenant_id","purpose","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;