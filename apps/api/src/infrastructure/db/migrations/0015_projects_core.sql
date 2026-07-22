CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"division" text,
	"parent_id" uuid,
	"kind" text NOT NULL,
	CONSTRAINT "ck_cost_codes_kind" CHECK ("cost_codes"."kind" in ('labor', 'material', 'equipment', 'subcontract', 'other'))
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"client_contact_company_id" uuid,
	"address" text,
	"geo" jsonb,
	"start_date" date,
	"target_end_date" date,
	"actual_end_date" date,
	"contract_value_amount" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"health" jsonb,
	"template_id" uuid,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ck_projects_status" CHECK ("projects"."status" in ('planning', 'active', 'on_hold', 'closed', 'warranty'))
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_users" ADD CONSTRAINT "project_users_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_users" ADD CONSTRAINT "project_users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_users" ADD CONSTRAINT "project_users_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_users" ADD CONSTRAINT "project_users_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_users" ADD CONSTRAINT "project_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_template_id_project_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_idempotency_keys_tenant_endpoint_key" ON "idempotency_keys" USING btree ("tenant_id","endpoint","key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_cost_codes_tenant_project_code" ON "cost_codes" USING btree ("tenant_id","project_id","code");--> statement-breakpoint
CREATE INDEX "ix_cost_codes_project_parent" ON "cost_codes" USING btree ("project_id","parent_id");--> statement-breakpoint
CREATE INDEX "ix_milestones_project" ON "milestones" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_project_users" ON "project_users" USING btree ("tenant_id","project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_projects_tenant_code" ON "projects" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ix_projects_tenant_status" ON "projects" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "ix_projects_name_trgm" ON "projects" USING gin ("name" gin_trgm_ops);