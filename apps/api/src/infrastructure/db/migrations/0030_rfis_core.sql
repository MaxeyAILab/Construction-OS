CREATE TABLE "rfis" (
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
	"subject" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"assigned_to_contact_id" uuid,
	"due_date" date,
	"cost_impact_flag" boolean DEFAULT false NOT NULL,
	"schedule_impact_flag" boolean DEFAULT false NOT NULL,
	"linked_activity_id" uuid,
	"linked_drawing_ref" uuid,
	CONSTRAINT "ck_rfis_status" CHECK ("rfis"."status" in ('draft', 'open', 'answered', 'closed', 'void'))
);
--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_linked_drawing_ref_document_versions_id_fk" FOREIGN KEY ("linked_drawing_ref") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_rfis_tenant_project_number" ON "rfis" USING btree ("tenant_id","project_id","number");--> statement-breakpoint
CREATE INDEX "ix_rfis_project_status" ON "rfis" USING btree ("project_id","status");