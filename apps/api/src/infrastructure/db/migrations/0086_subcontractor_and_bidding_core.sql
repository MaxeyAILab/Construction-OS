CREATE TABLE "bid_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"bid_package_id" uuid NOT NULL,
	"subcontractor_id" uuid NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'invited' NOT NULL,
	CONSTRAINT "ck_bid_invitations_status" CHECK ("bid_invitations"."status" in ('invited', 'declined', 'submitted'))
);
--> statement-breakpoint
CREATE TABLE "bid_packages" (
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
	"scope" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"due_date" date,
	CONSTRAINT "ck_bid_packages_status" CHECK ("bid_packages"."status" in ('draft', 'open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"bid_invitation_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"inclusions_exclusions" jsonb,
	"leveled_score" numeric(5, 2),
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subcontract_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"subcontract_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractors" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"trades" text[],
	"contact" jsonb,
	"prequal_status" text DEFAULT 'pending' NOT NULL,
	"performance" jsonb,
	CONSTRAINT "ck_subcontractors_prequal_status" CHECK ("subcontractors"."prequal_status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "subcontracts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"subcontractor_id" uuid NOT NULL,
	"scope" text,
	"retainage_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "ck_subcontracts_status" CHECK ("subcontracts"."status" in ('draft', 'pending_approval', 'approved', 'void'))
);
--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "holder_subcontractor_id" uuid;--> statement-breakpoint
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_bid_package_id_bid_packages_id_fk" FOREIGN KEY ("bid_package_id") REFERENCES "public"."bid_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_packages" ADD CONSTRAINT "bid_packages_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_packages" ADD CONSTRAINT "bid_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_packages" ADD CONSTRAINT "bid_packages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_packages" ADD CONSTRAINT "bid_packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bid_invitation_id_bid_invitations_id_fk" FOREIGN KEY ("bid_invitation_id") REFERENCES "public"."bid_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_subcontract_id_subcontracts_id_fk" FOREIGN KEY ("subcontract_id") REFERENCES "public"."subcontracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_lines" ADD CONSTRAINT "subcontract_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bid_invitations_package_subcontractor" ON "bid_invitations" USING btree ("bid_package_id","subcontractor_id");--> statement-breakpoint
CREATE INDEX "ix_bid_packages_project" ON "bid_packages" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bids_invitation" ON "bids" USING btree ("bid_invitation_id");--> statement-breakpoint
CREATE INDEX "ix_subcontract_lines_subcontract" ON "subcontract_lines" USING btree ("subcontract_id");--> statement-breakpoint
CREATE INDEX "ix_subcontracts_tenant_project_status" ON "subcontracts" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_holder_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("holder_subcontractor_id") REFERENCES "public"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_certifications_holder_subcontractor" ON "certifications" USING btree ("holder_subcontractor_id");