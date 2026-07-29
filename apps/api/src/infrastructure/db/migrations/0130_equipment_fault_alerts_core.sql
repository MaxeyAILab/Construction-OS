CREATE TABLE "equipment_fault_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"failed_inspection_count" integer NOT NULL,
	"window_days" integer NOT NULL,
	"description" text NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"latest_inspection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment_fault_alerts" ADD CONSTRAINT "equipment_fault_alerts_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_fault_alerts" ADD CONSTRAINT "equipment_fault_alerts_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_fault_alerts" ADD CONSTRAINT "equipment_fault_alerts_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_fault_alerts" ADD CONSTRAINT "equipment_fault_alerts_latest_inspection_id_equipment_inspections_id_fk" FOREIGN KEY ("latest_inspection_id") REFERENCES "public"."equipment_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_equipment_fault_alerts_tenant_created" ON "equipment_fault_alerts" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_equipment_fault_alerts_equipment_latest_inspection" ON "equipment_fault_alerts" USING btree ("equipment_id","latest_inspection_id");