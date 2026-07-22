CREATE TABLE "client_selections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"options" jsonb NOT NULL,
	"allowance_amount" numeric(14, 2),
	"selected_option" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "ck_client_selections_status" CHECK ("client_selections"."status" in ('pending', 'decided'))
);
--> statement-breakpoint
CREATE TABLE "portal_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "ck_portal_messages_audience" CHECK ("portal_messages"."audience" in ('client', 'subcontractor', 'supplier'))
);
--> statement-breakpoint
ALTER TABLE "client_selections" ADD CONSTRAINT "client_selections_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_selections" ADD CONSTRAINT "client_selections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_selections" ADD CONSTRAINT "client_selections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_selections" ADD CONSTRAINT "client_selections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_selections" ADD CONSTRAINT "client_selections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_client_selections_project_status" ON "client_selections" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "ix_portal_messages_entity" ON "portal_messages" USING btree ("tenant_id","entity_type","entity_id");