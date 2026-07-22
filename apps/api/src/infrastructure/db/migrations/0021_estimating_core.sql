CREATE TABLE "assemblies" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"uom" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assembly_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"assembly_id" uuid NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"qty_per_unit" numeric(14, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_item_price_history" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"source" text NOT NULL,
	"unit_cost_amount" numeric(14, 4) NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_cost_item_price_history_source" CHECK ("cost_item_price_history"."source" in ('po', 'invoice', 'manual', 'supplier_quote'))
);
--> statement-breakpoint
CREATE TABLE "cost_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"uom" text NOT NULL,
	"current_unit_cost_amount" numeric(14, 4) DEFAULT '0' NOT NULL,
	"labor_hours_per_unit" numeric(10, 4)
);
--> statement-breakpoint
CREATE TABLE "estimate_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"estimate_id" uuid NOT NULL,
	"cost_code_ref" text NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"uom" text NOT NULL,
	"unit_cost_amount" numeric(14, 4) NOT NULL,
	"unit_price_amount" numeric(14, 4),
	"total_cost_amount" numeric(14, 2) GENERATED ALWAYS AS (round(qty * unit_cost_amount, 2)) STORED,
	"total_price_amount" numeric(14, 2) GENERATED ALWAYS AS (round(qty * unit_price_amount, 2)) STORED,
	"assembly_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"ai_run_id" uuid,
	CONSTRAINT "ck_estimate_lines_source" CHECK ("estimate_lines"."source" in ('manual', 'assembly', 'ai', 'historical'))
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"opportunity_id" uuid,
	"project_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"markup_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"overhead_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"contingency_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"subtotal_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"valid_until" date,
	CONSTRAINT "ck_estimates_status" CHECK ("estimates"."status" in ('draft', 'submitted', 'won', 'lost', 'superseded')),
	CONSTRAINT "ck_estimates_parent" CHECK (("estimates"."opportunity_id" is null) <> ("estimates"."project_id" is null))
);
--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_items" ADD CONSTRAINT "assembly_items_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_items" ADD CONSTRAINT "assembly_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_items" ADD CONSTRAINT "assembly_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_items" ADD CONSTRAINT "assembly_items_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_items" ADD CONSTRAINT "assembly_items_cost_item_id_cost_items_id_fk" FOREIGN KEY ("cost_item_id") REFERENCES "public"."cost_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_item_price_history" ADD CONSTRAINT "cost_item_price_history_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_item_price_history" ADD CONSTRAINT "cost_item_price_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_item_price_history" ADD CONSTRAINT "cost_item_price_history_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_item_price_history" ADD CONSTRAINT "cost_item_price_history_cost_item_id_cost_items_id_fk" FOREIGN KEY ("cost_item_id") REFERENCES "public"."cost_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_assemblies_tenant_code" ON "assemblies" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ix_assembly_items_assembly" ON "assembly_items" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX "ix_cost_item_price_history_item_date" ON "cost_item_price_history" USING btree ("cost_item_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_cost_items_tenant_code" ON "cost_items" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ix_estlines_estimate" ON "estimate_lines" USING btree ("estimate_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_estimates_tenant_parent_version" ON "estimates" USING btree ("tenant_id",coalesce("opportunity_id", "project_id"),"version");