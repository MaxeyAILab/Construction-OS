-- Custom SQL migration file, put your code below! --

CREATE TRIGGER trg_folders_audit BEFORE INSERT OR UPDATE ON "folders"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_documents_audit BEFORE INSERT OR UPDATE ON "documents"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_document_versions_audit BEFORE INSERT OR UPDATE ON "document_versions"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_drawing_sets_audit BEFORE INSERT OR UPDATE ON "drawing_sets"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint
CREATE TRIGGER trg_drawing_set_sheets_audit BEFORE INSERT OR UPDATE ON "drawing_set_sheets"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "folders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "folders"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "documents"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_versions"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "drawing_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "drawing_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "drawing_sets"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

ALTER TABLE "drawing_set_sheets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "drawing_set_sheets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "drawing_set_sheets"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
