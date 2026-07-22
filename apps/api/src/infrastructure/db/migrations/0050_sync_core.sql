CREATE TABLE "sync_mutations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"mutation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"conflict_detail" jsonb,
	CONSTRAINT "ck_sync_mutations_op" CHECK ("sync_mutations"."op" in ('create', 'update', 'delete')),
	CONSTRAINT "ck_sync_mutations_result" CHECK ("sync_mutations"."result" in ('applied', 'merged', 'conflict', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sync_mutations_tenant_mutation" ON "sync_mutations" USING btree ("tenant_id","mutation_id");--> statement-breakpoint
CREATE INDEX "ix_sync_mutations_tenant_user_applied" ON "sync_mutations" USING btree ("tenant_id","user_id","applied_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_sync_mutations_tenant_result" ON "sync_mutations" USING btree ("tenant_id","result");