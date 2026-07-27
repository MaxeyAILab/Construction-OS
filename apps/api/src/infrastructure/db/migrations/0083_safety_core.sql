CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"holder_user_id" uuid,
	"holder_name" text NOT NULL,
	"cert_type" text NOT NULL,
	"issued_at" date,
	"expires_at" date
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text DEFAULT 'incident' NOT NULL,
	"severity" text DEFAULT 'low' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location" text,
	"description" text,
	"people" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"corrective_action_task_id" uuid,
	"osha_recordable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ck_incidents_kind" CHECK ("incidents"."kind" in ('incident', 'near_miss', 'observation')),
	CONSTRAINT "ck_incidents_severity" CHECK ("incidents"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "ck_incidents_status" CHECK ("incidents"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "safety_form_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'toolbox_talk' NOT NULL,
	"schema" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ck_safety_form_templates_kind" CHECK ("safety_form_templates"."kind" in ('toolbox_talk', 'inspection'))
);
--> statement-breakpoint
CREATE TABLE "safety_forms" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"template_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signatures" jsonb
);
--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_corrective_action_task_id_tasks_id_fk" FOREIGN KEY ("corrective_action_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_form_templates" ADD CONSTRAINT "safety_form_templates_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_form_templates" ADD CONSTRAINT "safety_form_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_form_templates" ADD CONSTRAINT "safety_form_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_forms" ADD CONSTRAINT "safety_forms_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_forms" ADD CONSTRAINT "safety_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_forms" ADD CONSTRAINT "safety_forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_forms" ADD CONSTRAINT "safety_forms_template_id_safety_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."safety_form_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_forms" ADD CONSTRAINT "safety_forms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_certifications_expires" ON "certifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ix_incidents_project_occurred" ON "incidents" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_safety_forms_project_created" ON "safety_forms" USING btree ("project_id","created_at");