CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"weather" jsonb,
	"narrative" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"ai_summary" text,
	CONSTRAINT "ck_daily_reports_status" CHECK ("daily_reports"."status" in ('draft', 'submitted'))
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"daily_report_id" uuid,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"crew_label" text,
	"cost_code_id" uuid NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"work_date" date NOT NULL,
	"kind" text DEFAULT 'regular' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"cost_transaction_id" uuid,
	CONSTRAINT "ck_time_entries_kind" CHECK ("time_entries"."kind" in ('regular', 'overtime')),
	CONSTRAINT "ck_time_entries_worker" CHECK ("time_entries"."user_id" is not null or "time_entries"."crew_label" is not null)
);
--> statement-breakpoint
ALTER TABLE "company_users" ADD COLUMN "hourly_rate_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_daily_report_id_daily_reports_id_fk" FOREIGN KEY ("daily_report_id") REFERENCES "public"."daily_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_daily_reports_tenant_project_date_author" ON "daily_reports" USING btree ("tenant_id","project_id","report_date","created_by");--> statement-breakpoint
CREATE INDEX "ix_time_tenant_user_date" ON "time_entries" USING btree ("tenant_id","user_id","work_date");--> statement-breakpoint
CREATE INDEX "ix_time_project_date" ON "time_entries" USING btree ("project_id","work_date");