CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"file_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"taken_at" timestamp with time zone NOT NULL,
	"geo_lat" numeric(9, 6),
	"geo_lng" numeric(9, 6),
	"heading" integer,
	"device_id" text,
	"ai_tags" jsonb
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_photos_tenant_project_taken" ON "photos" USING btree ("tenant_id","project_id","taken_at");--> statement-breakpoint
CREATE INDEX "ix_photos_entity" ON "photos" USING btree ("entity_type","entity_id");