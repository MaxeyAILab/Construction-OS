CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"chunk_no" integer NOT NULL,
	"content_hash" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"meta" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_embeddings_tenant_entity_chunk_hash" ON "embeddings" USING btree ("tenant_id","entity_type","entity_id","chunk_no","content_hash");--> statement-breakpoint
CREATE INDEX "ix_embeddings_tenant_entity" ON "embeddings" USING btree ("tenant_id","entity_type","entity_id");