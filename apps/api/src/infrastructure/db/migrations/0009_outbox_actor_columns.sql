ALTER TABLE "outbox" ADD COLUMN "actor_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "actor_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "ck_outbox_actor_type" CHECK ("outbox"."actor_type" in ('user', 'system', 'ai', 'integration'));