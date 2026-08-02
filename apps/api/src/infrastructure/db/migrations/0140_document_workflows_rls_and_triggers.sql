-- Custom SQL migration file, put your code below! --

-- database.md §25 (FR-DOC-8/9). All seven tables are ordinary
-- tenantColumns() tables — audit trigger + RLS, same shape as every other
-- module.

CREATE TRIGGER trg_transmittals_audit BEFORE INSERT OR UPDATE ON "transmittals"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "transmittals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transmittals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transmittals"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_transmittal_items_audit BEFORE INSERT OR UPDATE ON "transmittal_items"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "transmittal_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transmittal_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transmittal_items"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_transmittal_recipients_audit BEFORE INSERT OR UPDATE ON "transmittal_recipients"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "transmittal_recipients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transmittal_recipients" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transmittal_recipients"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_approval_matrices_audit BEFORE INSERT OR UPDATE ON "approval_matrices"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "approval_matrices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approval_matrices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_matrices"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_approval_matrix_steps_audit BEFORE INSERT OR UPDATE ON "approval_matrix_steps"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "approval_matrix_steps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approval_matrix_steps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_matrix_steps"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_approval_instances_audit BEFORE INSERT OR UPDATE ON "approval_instances"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "approval_instances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approval_instances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_instances"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint

CREATE TRIGGER trg_approval_instance_decisions_audit BEFORE INSERT OR UPDATE ON "approval_instance_decisions"
	FOR EACH ROW EXECUTE FUNCTION assign_tenant_audit_columns();
--> statement-breakpoint

ALTER TABLE "approval_instance_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approval_instance_decisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_instance_decisions"
	USING ("tenant_id" = current_setting('app.tenant_id')::uuid);
