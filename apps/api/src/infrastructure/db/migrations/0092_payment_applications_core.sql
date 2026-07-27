CREATE TABLE "payment_application_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"payment_application_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"scheduled_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"previous_completed" numeric(14, 2) DEFAULT '0' NOT NULL,
	"this_period" numeric(14, 2) DEFAULT '0' NOT NULL,
	"materials_stored" numeric(14, 2) DEFAULT '0' NOT NULL,
	"completed_to_date" numeric(14, 2) GENERATED ALWAYS AS (previous_completed + this_period + materials_stored) STORED,
	"retainage_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"retainage_amount" numeric(14, 2) GENERATED ALWAYS AS (round((previous_completed + this_period + materials_stored) * retainage_pct / 100, 2)) STORED
);
--> statement-breakpoint
CREATE TABLE "payment_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"period_number" integer NOT NULL,
	"period_end_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pdf_status" text DEFAULT 'none' NOT NULL,
	"pdf_document_version_id" uuid,
	"invoice_id" uuid,
	"total_scheduled_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_completed_and_stored" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_retainage" numeric(14, 2) DEFAULT '0' NOT NULL,
	"current_payment_due" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "ck_payment_applications_status" CHECK ("payment_applications"."status" in ('draft', 'submitted', 'approved', 'void')),
	CONSTRAINT "ck_payment_applications_pdf_status" CHECK ("payment_applications"."pdf_status" in ('none', 'generating', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ALTER COLUMN "unit_price_amount" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "payment_application_lines" ADD CONSTRAINT "payment_application_lines_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_application_lines" ADD CONSTRAINT "payment_application_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_application_lines" ADD CONSTRAINT "payment_application_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_application_lines" ADD CONSTRAINT "payment_application_lines_payment_application_id_payment_applications_id_fk" FOREIGN KEY ("payment_application_id") REFERENCES "public"."payment_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_application_lines" ADD CONSTRAINT "payment_application_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_pdf_document_version_id_document_versions_id_fk" FOREIGN KEY ("pdf_document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payment_application_lines_app_cost_code" ON "payment_application_lines" USING btree ("payment_application_id","cost_code_id");--> statement-breakpoint
CREATE INDEX "ix_payment_application_lines_app" ON "payment_application_lines" USING btree ("payment_application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payment_applications_project_period" ON "payment_applications" USING btree ("tenant_id","project_id","period_number");--> statement-breakpoint
CREATE INDEX "ix_payment_applications_project_status" ON "payment_applications" USING btree ("project_id","status");