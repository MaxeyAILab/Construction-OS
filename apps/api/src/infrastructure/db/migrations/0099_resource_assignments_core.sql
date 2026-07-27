CREATE TABLE "resource_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"activity_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"equipment_id" uuid,
	"crew_label" text,
	"resource_key" text GENERATED ALWAYS AS (resource_type || ':' || coalesce(equipment_id::text, crew_label)) STORED,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_resource_assignments_type" CHECK ("resource_assignments"."resource_type" in ('crew', 'equipment')),
	CONSTRAINT "ck_resource_assignments_target" CHECK (("resource_assignments"."resource_type" = 'equipment' and "resource_assignments"."equipment_id" is not null and "resource_assignments"."crew_label" is null)
        or ("resource_assignments"."resource_type" = 'crew' and "resource_assignments"."crew_label" is not null and "resource_assignments"."equipment_id" is null)),
	CONSTRAINT "ck_resource_assignments_dates" CHECK ("resource_assignments"."end_at" > "resource_assignments"."start_at")
);
--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_activity_id_schedule_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."schedule_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_resource_assignments_activity" ON "resource_assignments" USING btree ("activity_id");