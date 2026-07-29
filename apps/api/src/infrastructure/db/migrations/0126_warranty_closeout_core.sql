CREATE TABLE "closeout_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"document_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	CONSTRAINT "ck_closeout_checklist_items_category" CHECK ("closeout_checklist_items"."category" in ('as_built_drawings', 'om_manuals', 'warranty_certificates', 'permits_certificate_of_occupancy', 'training_signoff', 'lien_waivers', 'other')),
	CONSTRAINT "ck_closeout_checklist_items_status" CHECK ("closeout_checklist_items"."status" in ('pending', 'complete', 'not_applicable'))
);
--> statement-breakpoint
CREATE TABLE "closeout_packages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'assembled' NOT NULL,
	"file_id" uuid NOT NULL,
	"assembled_by" uuid NOT NULL,
	"assembled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_closeout_packages_status" CHECK ("closeout_packages"."status" in ('assembled', 'delivered'))
);
--> statement-breakpoint
CREATE TABLE "warranties" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"warranty_type" text NOT NULL,
	"responsible_party_type" text NOT NULL,
	"responsible_subcontractor_id" uuid,
	"responsible_supplier_id" uuid,
	"start_date" date NOT NULL,
	"duration_months" integer NOT NULL,
	"document_id" uuid,
	CONSTRAINT "ck_warranties_type" CHECK ("warranties"."warranty_type" in ('labor', 'material', 'manufacturer')),
	CONSTRAINT "ck_warranties_responsible_party_type" CHECK ("warranties"."responsible_party_type" in ('subcontractor', 'supplier', 'manufacturer'))
);
--> statement-breakpoint
CREATE TABLE "warranty_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"warranty_id" uuid NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"resolution_notes" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "ck_warranty_claims_status" CHECK ("warranty_claims"."status" in ('submitted', 'acknowledged', 'in_progress', 'resolved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "closeout_checklist_items" ADD CONSTRAINT "closeout_checklist_items_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_checklist_items" ADD CONSTRAINT "closeout_checklist_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_checklist_items" ADD CONSTRAINT "closeout_checklist_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_checklist_items" ADD CONSTRAINT "closeout_checklist_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_checklist_items" ADD CONSTRAINT "closeout_checklist_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_checklist_items" ADD CONSTRAINT "closeout_checklist_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_packages" ADD CONSTRAINT "closeout_packages_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_packages" ADD CONSTRAINT "closeout_packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_packages" ADD CONSTRAINT "closeout_packages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closeout_packages" ADD CONSTRAINT "closeout_packages_assembled_by_users_id_fk" FOREIGN KEY ("assembled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_responsible_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("responsible_subcontractor_id") REFERENCES "public"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_responsible_supplier_id_suppliers_id_fk" FOREIGN KEY ("responsible_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_warranty_id_warranties_id_fk" FOREIGN KEY ("warranty_id") REFERENCES "public"."warranties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_closeout_checklist_items_project" ON "closeout_checklist_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_closeout_packages_project_assembled" ON "closeout_packages" USING btree ("project_id","assembled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_warranties_project" ON "warranties" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_warranty_claims_warranty" ON "warranty_claims" USING btree ("warranty_id");