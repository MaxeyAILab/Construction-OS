CREATE TABLE "finance_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"margin_pct" numeric(6, 2) NOT NULL,
	"threshold_pct" numeric(6, 2) NOT NULL,
	"explanation" text,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_finance_alerts_kind" CHECK ("finance_alerts"."kind" in ('margin_erosion')),
	CONSTRAINT "ck_finance_alerts_severity" CHECK ("finance_alerts"."severity" in ('warning', 'critical'))
);
--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD CONSTRAINT "finance_alerts_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD CONSTRAINT "finance_alerts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD CONSTRAINT "finance_alerts_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_finance_alerts_tenant_project_created" ON "finance_alerts" USING btree ("tenant_id","project_id","created_at" DESC NULLS LAST);