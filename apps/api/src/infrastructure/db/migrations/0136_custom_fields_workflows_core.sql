CREATE TABLE "custom_field_automations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"trigger_field_definition_id" uuid NOT NULL,
	"trigger_value" jsonb NOT NULL,
	"action_type" text NOT NULL,
	"action_field_definition_id" uuid,
	"action_value" jsonb,
	"action_notify_user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ck_custom_field_automations_entity_type" CHECK ("custom_field_automations"."entity_type" in ('project', 'task', 'rfi', 'change_order', 'submittal')),
	CONSTRAINT "ck_custom_field_automations_action_type" CHECK ("custom_field_automations"."action_type" in ('set_field', 'notify_user'))
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"entity_type" text NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" jsonb,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ck_custom_field_definitions_entity_type" CHECK ("custom_field_definitions"."entity_type" in ('project', 'task', 'rfi', 'change_order', 'submittal')),
	CONSTRAINT "ck_custom_field_definitions_field_type" CHECK ("custom_field_definitions"."field_type" in ('text', 'number', 'boolean', 'date', 'select'))
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"updated_seq" bigint DEFAULT 0 NOT NULL,
	"field_definition_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "ck_custom_field_values_entity_type" CHECK ("custom_field_values"."entity_type" in ('project', 'task', 'rfi', 'change_order', 'submittal'))
);
--> statement-breakpoint
ALTER TABLE "custom_field_automations" ADD CONSTRAINT "custom_field_automations_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_automations" ADD CONSTRAINT "custom_field_automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_automations" ADD CONSTRAINT "custom_field_automations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_automations" ADD CONSTRAINT "custom_field_automations_trigger_field_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("trigger_field_definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_automations" ADD CONSTRAINT "custom_field_automations_action_field_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("action_field_definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_automations" ADD CONSTRAINT "custom_field_automations_action_notify_user_id_users_id_fk" FOREIGN KEY ("action_notify_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_field_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("field_definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_custom_field_automations_trigger" ON "custom_field_automations" USING btree ("tenant_id","trigger_field_definition_id") WHERE "custom_field_automations"."is_active" and "custom_field_automations"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_custom_field_definitions_tenant_entity_key" ON "custom_field_definitions" USING btree ("tenant_id","entity_type","field_key") WHERE "custom_field_definitions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ix_custom_field_definitions_tenant_entity" ON "custom_field_definitions" USING btree ("tenant_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_custom_field_values_tenant_field_entity" ON "custom_field_values" USING btree ("tenant_id","field_definition_id","entity_id");--> statement-breakpoint
CREATE INDEX "ix_custom_field_values_tenant_entity" ON "custom_field_values" USING btree ("tenant_id","entity_type","entity_id");