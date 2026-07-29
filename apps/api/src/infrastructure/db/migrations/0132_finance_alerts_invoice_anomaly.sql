ALTER TABLE "finance_alerts" DROP CONSTRAINT "ck_finance_alerts_kind";--> statement-breakpoint
ALTER TABLE "finance_alerts" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_alerts" ALTER COLUMN "margin_pct" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_alerts" ALTER COLUMN "threshold_pct" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD COLUMN "duplicate_of_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD COLUMN "match_reason" text;--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD CONSTRAINT "finance_alerts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD CONSTRAINT "finance_alerts_duplicate_of_invoice_id_invoices_id_fk" FOREIGN KEY ("duplicate_of_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD CONSTRAINT "ck_finance_alerts_match_reason" CHECK ("finance_alerts"."match_reason" is null or "finance_alerts"."match_reason" in ('external_ref', 'amount_and_date'));--> statement-breakpoint
ALTER TABLE "finance_alerts" ADD CONSTRAINT "ck_finance_alerts_kind" CHECK ("finance_alerts"."kind" in ('margin_erosion', 'invoice_duplicate'));