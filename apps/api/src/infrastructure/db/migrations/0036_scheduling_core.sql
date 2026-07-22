CREATE TABLE "activity_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"predecessor_id" uuid NOT NULL,
	"successor_id" uuid NOT NULL,
	"type" text DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_activity_dependencies_type" CHECK ("activity_dependencies"."type" in ('FS', 'SS', 'FF', 'SF'))
);
--> statement-breakpoint
CREATE TABLE "schedule_activities" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"schedule_id" uuid NOT NULL,
	"wbs_path" text,
	"name" text NOT NULL,
	"duration_days" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"actual_start_date" date,
	"actual_end_date" date,
	"percent_complete" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"total_float_days" integer,
	"crew" jsonb,
	"cost_code_id" uuid,
	"baseline_source_activity_id" uuid,
	CONSTRAINT "ck_schedule_activities_duration" CHECK ("schedule_activities"."duration_days" >= 0),
	CONSTRAINT "ck_schedule_activities_percent" CHECK ("schedule_activities"."percent_complete" >= 0 and "schedule_activities"."percent_complete" <= 100)
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text DEFAULT 'master' NOT NULL,
	"baseline_of_id" uuid,
	"name" text,
	"data_date" date NOT NULL,
	"schedule_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_schedules_kind" CHECK ("schedules"."kind" in ('master', 'baseline', 'lookahead'))
);
--> statement-breakpoint
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_predecessor_id_schedule_activities_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."schedule_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_successor_id_schedule_activities_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."schedule_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_baseline_source_activity_id_schedule_activities_id_fk" FOREIGN KEY ("baseline_source_activity_id") REFERENCES "public"."schedule_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_baseline_of_id_schedules_id_fk" FOREIGN KEY ("baseline_of_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_activity_dependencies_pair" ON "activity_dependencies" USING btree ("predecessor_id","successor_id");--> statement-breakpoint
CREATE INDEX "ix_activity_dependencies_successor" ON "activity_dependencies" USING btree ("successor_id");--> statement-breakpoint
CREATE INDEX "ix_activities_schedule_start" ON "schedule_activities" USING btree ("schedule_id","start_date");--> statement-breakpoint
CREATE INDEX "ix_activities_tenant_dates" ON "schedule_activities" USING btree ("tenant_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "ix_schedules_project_kind" ON "schedules" USING btree ("project_id","kind");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_schedule_activity_id_schedule_activities_id_fk" FOREIGN KEY ("schedule_activity_id") REFERENCES "public"."schedule_activities"("id") ON DELETE no action ON UPDATE no action;