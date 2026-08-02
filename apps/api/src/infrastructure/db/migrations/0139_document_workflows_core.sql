CREATE TABLE "approval_instance_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"approval_instance_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"comments" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_approval_instance_decisions_decision" CHECK ("approval_instance_decisions"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "approval_instances" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"approval_matrix_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"current_step_order" integer NOT NULL,
	CONSTRAINT "ck_approval_instances_entity_type" CHECK ("approval_instances"."entity_type" in ('document', 'transmittal')),
	CONSTRAINT "ck_approval_instances_status" CHECK ("approval_instances"."status" in ('in_progress', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "approval_matrices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ck_approval_matrices_entity_type" CHECK ("approval_matrices"."entity_type" in ('document', 'transmittal'))
);
--> statement-breakpoint
CREATE TABLE "approval_matrix_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"approval_matrix_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "transmittal_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"transmittal_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "transmittal_recipients" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"transmittal_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transmittals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"purpose" text NOT NULL,
	"subject" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	CONSTRAINT "ck_transmittals_purpose" CHECK ("transmittals"."purpose" in ('for_review', 'for_approval', 'for_record', 'as_requested')),
	CONSTRAINT "ck_transmittals_status" CHECK ("transmittals"."status" in ('draft', 'sent'))
);
--> statement-breakpoint
ALTER TABLE "approval_instance_decisions" ADD CONSTRAINT "approval_instance_decisions_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instance_decisions" ADD CONSTRAINT "approval_instance_decisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instance_decisions" ADD CONSTRAINT "approval_instance_decisions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instance_decisions" ADD CONSTRAINT "approval_instance_decisions_approval_instance_id_approval_instances_id_fk" FOREIGN KEY ("approval_instance_id") REFERENCES "public"."approval_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instance_decisions" ADD CONSTRAINT "approval_instance_decisions_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_approval_matrix_id_approval_matrices_id_fk" FOREIGN KEY ("approval_matrix_id") REFERENCES "public"."approval_matrices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrices" ADD CONSTRAINT "approval_matrices_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrices" ADD CONSTRAINT "approval_matrices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrices" ADD CONSTRAINT "approval_matrices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_steps" ADD CONSTRAINT "approval_matrix_steps_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_steps" ADD CONSTRAINT "approval_matrix_steps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_steps" ADD CONSTRAINT "approval_matrix_steps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_steps" ADD CONSTRAINT "approval_matrix_steps_approval_matrix_id_approval_matrices_id_fk" FOREIGN KEY ("approval_matrix_id") REFERENCES "public"."approval_matrices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_steps" ADD CONSTRAINT "approval_matrix_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_items" ADD CONSTRAINT "transmittal_items_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_items" ADD CONSTRAINT "transmittal_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_items" ADD CONSTRAINT "transmittal_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_items" ADD CONSTRAINT "transmittal_items_transmittal_id_transmittals_id_fk" FOREIGN KEY ("transmittal_id") REFERENCES "public"."transmittals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_items" ADD CONSTRAINT "transmittal_items_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_recipients" ADD CONSTRAINT "transmittal_recipients_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_recipients" ADD CONSTRAINT "transmittal_recipients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_recipients" ADD CONSTRAINT "transmittal_recipients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_recipients" ADD CONSTRAINT "transmittal_recipients_transmittal_id_transmittals_id_fk" FOREIGN KEY ("transmittal_id") REFERENCES "public"."transmittals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_recipients" ADD CONSTRAINT "transmittal_recipients_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_approval_instance_decisions_instance" ON "approval_instance_decisions" USING btree ("tenant_id","approval_instance_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_approval_instances_tenant_entity_in_progress" ON "approval_instances" USING btree ("tenant_id","entity_type","entity_id") WHERE "approval_instances"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "ix_approval_instances_tenant_entity" ON "approval_instances" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ix_approval_matrices_tenant_entity" ON "approval_matrices" USING btree ("tenant_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_approval_matrix_steps_tenant_matrix_order" ON "approval_matrix_steps" USING btree ("tenant_id","approval_matrix_id","step_order");--> statement-breakpoint
CREATE INDEX "ix_approval_matrix_steps_matrix_order" ON "approval_matrix_steps" USING btree ("tenant_id","approval_matrix_id","step_order");--> statement-breakpoint
CREATE INDEX "ix_transmittal_items_transmittal" ON "transmittal_items" USING btree ("tenant_id","transmittal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_transmittal_recipients_tenant_transmittal_user" ON "transmittal_recipients" USING btree ("tenant_id","transmittal_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX "ix_transmittal_recipients_transmittal" ON "transmittal_recipients" USING btree ("tenant_id","transmittal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_transmittals_tenant_project_number" ON "transmittals" USING btree ("tenant_id","project_id","number");--> statement-breakpoint
CREATE INDEX "ix_transmittals_tenant_project" ON "transmittals" USING btree ("tenant_id","project_id");