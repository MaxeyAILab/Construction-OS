-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_submittals_audit BEFORE INSERT OR UPDATE ON "submittals"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "submittals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "submittals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "submittals"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_annotations_audit BEFORE INSERT OR UPDATE ON "annotations"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "annotations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "annotations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "annotations"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);