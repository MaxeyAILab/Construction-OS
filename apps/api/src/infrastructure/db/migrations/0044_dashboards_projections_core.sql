CREATE TABLE "projection_company_kpis" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_count" integer DEFAULT 0 NOT NULL,
	"active_project_count" integer DEFAULT 0 NOT NULL,
	"total_revised_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total_actual_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total_forecast_at_completion_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total_margin_amount" numeric(16, 2),
	"pipeline_value_amount" numeric(16, 2),
	"cash_position_amount" numeric(16, 2),
	"overdue_ar_amount" numeric(16, 2),
	"safety_trir" numeric(7, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_project_financials" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"original_total_amount" numeric(14, 2) NOT NULL,
	"revised_total_amount" numeric(14, 2) NOT NULL,
	"committed_total_amount" numeric(14, 2) NOT NULL,
	"actual_total_amount" numeric(14, 2) NOT NULL,
	"cost_to_complete_amount" numeric(14, 2) NOT NULL,
	"forecast_at_completion_amount" numeric(14, 2) NOT NULL,
	"margin_amount" numeric(14, 2),
	"margin_pct" numeric(7, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projection_company_kpis" ADD CONSTRAINT "projection_company_kpis_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_project_financials" ADD CONSTRAINT "projection_project_financials_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_project_financials" ADD CONSTRAINT "projection_project_financials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_projection_company_kpis_tenant" ON "projection_company_kpis" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_projection_project_financials_tenant_project" ON "projection_project_financials" USING btree ("tenant_id","project_id");