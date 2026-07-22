CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"budget_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"original_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"approved_changes_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"revised_amount" numeric(14, 2) GENERATED ALWAYS AS (original_amount + approved_changes_amount) STORED,
	"committed_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"actual_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"forecast_to_complete_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"forecast_at_completion_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "ck_budget_lines_amounts" CHECK ("budget_lines"."original_amount" >= 0 and "budget_lines"."committed_amount" >= 0 and "budget_lines"."actual_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"source_estimate_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"original_total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"revised_total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	CONSTRAINT "ck_budgets_status" CHECK ("budgets"."status" in ('active', 'locked', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "ck_commitments_kind" CHECK ("commitments"."kind" in ('purchase_order', 'subcontract')),
	CONSTRAINT "ck_commitments_status" CHECK ("commitments"."status" in ('active', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "cost_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"txn_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"qty" numeric(14, 3),
	"uom" text,
	"memo" text,
	"external_ref" text,
	CONSTRAINT "ck_cost_transactions_source" CHECK ("cost_transactions"."source" in ('supplier_invoice', 'sub_invoice', 'time_entry', 'equipment_usage', 'inventory_issue', 'manual', 'accounting_sync'))
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_transactions" ADD CONSTRAINT "cost_transactions_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_budget_lines_budget_cost_code" ON "budget_lines" USING btree ("budget_id","cost_code_id");--> statement-breakpoint
CREATE INDEX "ix_budget_lines_budget" ON "budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_budgets_tenant_project_active" ON "budgets" USING btree ("tenant_id","project_id") WHERE "budgets"."status" = 'active';--> statement-breakpoint
CREATE INDEX "ix_commitments_project_cost_code" ON "commitments" USING btree ("project_id","cost_code_id");--> statement-breakpoint
CREATE INDEX "ix_costtxn_tenant_project_code_date" ON "cost_transactions" USING btree ("tenant_id","project_id","cost_code_id","txn_date");--> statement-breakpoint
CREATE INDEX "ix_costtxn_source" ON "cost_transactions" USING btree ("source","source_id");