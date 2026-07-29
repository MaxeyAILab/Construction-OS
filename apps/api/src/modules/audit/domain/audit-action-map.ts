import type { EventType } from "@constructionos/schemas";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  // ai-spec.md §6: "every execution -> audit_log with ai_run_id" — set
  // only by mappers for AI-driven mutations (currently just
  // photo.tagged.v1); every human-driven mapper below leaves this unset.
  aiRunId?: string;
}

type AuditMapper = (payload: Record<string, unknown>) => AuditEntry;

// database.md §6: action strings reuse the exact admin.* permission key
// that gates the corresponding mutation (api.md §1.1's module.resource.action
// convention) — e.g. role.created.v1 -> "admin.role.manage" because
// RbacController.createRole is @RequirePermission('admin.role.manage').
// That keeps "what permission let this happen" and "what got logged"
// traceable to the same string instead of a parallel vocabulary.
const mappers: Partial<Record<EventType, AuditMapper>> = {
  "company.registered.v1": (payload) => ({
    action: "admin.company.register",
    entityType: "company",
    entityId: payload.companyId as string,
  }),
  // Roadmap Phase 2 "Second locale + metric units (NFR-30 activation)":
  // PATCH /admin/company. Unlike user.preferences_updated.v1 (self-service,
  // deliberately unaudited — see that event's doc comment), this is a
  // privileged admin.company.manage-gated mutation, same audit-worthiness
  // tier as company.registered.v1 above.
  "company.updated.v1": (payload) => ({
    action: "admin.company.manage",
    entityType: "company",
    entityId: payload.companyId as string,
  }),
  "user.invited.v1": (payload) => ({
    action: "admin.company_user.invite",
    entityType: "user",
    entityId: payload.userId as string,
  }),
  "role.assigned.v1": (payload) => ({
    action: "admin.user_role.assign",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  "role.created.v1": (payload) => ({
    action: "admin.role.manage",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  "permission.granted.v1": (payload) => ({
    action: "admin.role.manage",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  "permission.revoked.v1": (payload) => ({
    action: "admin.role.manage",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  "company_user.removed.v1": (payload) => ({
    action: "admin.company_user.remove",
    entityType: "user",
    entityId: payload.userId as string,
  }),
  "user_role.revoked.v1": (payload) => ({
    action: "admin.user_role.revoke",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  // spec.md §10.2 (Segregation of duties): queued creation is auditable in
  // its own right (a request that never gets decided is still a signal),
  // separate from the eventual role.assigned.v1/permission.granted.v1 etc.
  // that fires only once an approver actually applies it.
  "permission_change_request.created.v1": (payload) => ({
    action: "admin.role.manage",
    entityType: "permission_change_request",
    entityId: payload.requestId as string,
  }),
  "permission_change_request.approved.v1": (payload) => ({
    action: "admin.role.manage",
    entityType: "permission_change_request",
    entityId: payload.requestId as string,
  }),
  "permission_change_request.rejected.v1": (payload) => ({
    action: "admin.role.manage",
    entityType: "permission_change_request",
    entityId: payload.requestId as string,
  }),
  // M13 Client Portal foundation (FR-RBAC-3).
  "external_share.created.v1": (payload) => ({
    action: "admin.share.manage",
    entityType: "external_share",
    entityId: payload.shareId as string,
  }),
  // files module has no HTTP endpoint yet (no consuming module — Documents/
  // Photos — exists to gate one), so there's no @RequirePermission key to
  // reuse; these follow api.md §1.1's module.resource.action shape anyway
  // for when one does exist.
  "file.uploaded.v1": (payload) => ({
    action: "files.file.upload",
    entityType: "file",
    entityId: payload.fileId as string,
  }),
  "file.scan_completed.v1": (payload) => ({
    action: "files.file.scan",
    entityType: "file",
    entityId: payload.fileId as string,
  }),
  // entityType "project" (not "cost_code"/"milestone"/"user") for the
  // sub-resource events too — "show me everything that happened to this
  // project" is the natural audit query shape for a PM; the full payload
  // (who/what specifically) is still in the stored `after` column.
  "project.created.v1": (payload) => ({
    action: "projects.project.create",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "project.updated.v1": (payload) => ({
    action: "projects.project.update",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "project.deleted.v1": (payload) => ({
    action: "projects.project.delete",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "project_member.added.v1": (payload) => ({
    action: "projects.member.manage",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "project_member.removed.v1": (payload) => ({
    action: "projects.member.manage",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "cost_code.created.v1": (payload) => ({
    action: "projects.costcode.manage",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "milestone.created.v1": (payload) => ({
    action: "projects.project.update",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "budget.created.v1": (payload) => ({
    action: "finance.budget.update",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "budget_line.created.v1": (payload) => ({
    action: "finance.budget.update",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "budget_line.updated.v1": (payload) => ({
    action: "finance.budget.update",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  "cost_transaction.posted.v1": (payload) => ({
    action: "finance.costtxn.create",
    entityType: "project",
    entityId: payload.projectId as string,
  }),
  // FR-FIN-6: fires after MarginErosionService persists a new
  // finance_alerts row — aiRunId is nullable (the rule always fires; the
  // causal-decomposition explanation is best-effort), same conditional
  // insert AuditWriterService already does for photo.tagged.v1/
  // daily_report.ai_summary_generated.v1.
  "finance_alert.created.v1": (payload) => ({
    action: "finance.alert.create",
    entityType: "finance_alert",
    entityId: payload.financeAlertId as string,
    ...(payload.aiRunId ? { aiRunId: payload.aiRunId as string } : {}),
  }),
  // M1 CRM & Pre-Construction (FR-CRM-1/2/4).
  "contact_company.created.v1": (payload) => ({
    action: "crm.contact.create",
    entityType: "contact_company",
    entityId: payload.contactCompanyId as string,
  }),
  "contact.created.v1": (payload) => ({
    action: "crm.contact.create",
    entityType: "contact",
    entityId: payload.contactId as string,
  }),
  "pipeline_stage.created.v1": (payload) => ({
    action: "crm.settings.manage",
    entityType: "pipeline_stage",
    entityId: payload.pipelineStageId as string,
  }),
  "opportunity.created.v1": (payload) => ({
    action: "crm.opportunity.create",
    entityType: "opportunity",
    entityId: payload.opportunityId as string,
  }),
  "opportunity.updated.v1": (payload) => ({
    action: "crm.opportunity.update",
    entityType: "opportunity",
    entityId: payload.opportunityId as string,
  }),
  // FR-CRM-4: "Atomic: marks won, creates project" — entityType stays
  // "opportunity" (the mutation this audits is the opportunity's own
  // status transition); the project it created gets its own
  // project.created.v1 audit row independently.
  "opportunity.won.v1": (payload) => ({
    action: "crm.opportunity.win",
    entityType: "opportunity",
    entityId: payload.opportunityId as string,
  }),
  "opportunity.lost.v1": (payload) => ({
    action: "crm.opportunity.update",
    entityType: "opportunity",
    entityId: payload.opportunityId as string,
  }),
  "activity.created.v1": (payload) => ({
    action: "crm.activity.create",
    entityType: "activity",
    entityId: payload.activityId as string,
  }),
  // M5 Procurement & Purchasing (FR-PROC-1..4).
  "supplier.created.v1": (payload) => ({
    action: "procurement.supplier.create",
    entityType: "supplier",
    entityId: payload.supplierId as string,
  }),
  // Procurement AI (FR-PROC-5): supplier scoring recompute.
  "supplier.rated.v1": (payload) => ({
    action: "procurement.supplier.update",
    entityType: "supplier",
    entityId: payload.supplierId as string,
  }),
  "purchase_order.created.v1": (payload) => ({
    action: "procurement.po.create",
    entityType: "purchase_order",
    entityId: payload.purchaseOrderId as string,
  }),
  "purchase_order.updated.v1": (payload) => ({
    action: "procurement.po.update",
    entityType: "purchase_order",
    entityId: payload.purchaseOrderId as string,
  }),
  // FR-PROC-3: the one PO transition with a real financial side effect
  // (the commitment write) gets its own action string, same "the
  // consequential action gets its own key" precedent as crm.opportunity.win.
  "purchase_order.approved.v1": (payload) => ({
    action: "procurement.po.approve",
    entityType: "purchase_order",
    entityId: payload.purchaseOrderId as string,
  }),
  "purchase_order_line.created.v1": (payload) => ({
    action: "procurement.po.update",
    entityType: "purchase_order",
    entityId: payload.purchaseOrderId as string,
  }),
  "rfq.created.v1": (payload) => ({
    action: "procurement.rfq.create",
    entityType: "rfq",
    entityId: payload.rfqId as string,
  }),
  "supplier_quote.created.v1": (payload) => ({
    action: "procurement.rfq.create",
    entityType: "rfq",
    entityId: payload.rfqId as string,
  }),
  "delivery.created.v1": (payload) => ({
    action: "procurement.delivery.create",
    entityType: "delivery",
    entityId: payload.deliveryId as string,
  }),
  // M10 Inventory & Materials (FR-INV-1..2).
  "inventory_item.created.v1": (payload) => ({
    action: "inventory.item.create",
    entityType: "inventory_item",
    entityId: payload.inventoryItemId as string,
  }),
  "inventory_location.created.v1": (payload) => ({
    action: "inventory.location.create",
    entityType: "inventory_location",
    entityId: payload.inventoryLocationId as string,
  }),
  "stock_movement.posted.v1": (payload) => ({
    action: "inventory.movement.create",
    entityType: "stock_movement",
    entityId: payload.stockMovementId as string,
  }),
  // M11 Equipment (FR-EQ-1..3).
  "equipment.created.v1": (payload) => ({
    action: "equipment.equipment.create",
    entityType: "equipment",
    entityId: payload.equipmentId as string,
  }),
  "equipment_assignment.created.v1": (payload) => ({
    action: "equipment.assignment.create",
    entityType: "equipment_assignment",
    entityId: payload.equipmentAssignmentId as string,
  }),
  "equipment_assignment.ended.v1": (payload) => ({
    action: "equipment.assignment.create",
    entityType: "equipment_assignment",
    entityId: payload.equipmentAssignmentId as string,
  }),
  "equipment_usage_log.created.v1": (payload) => ({
    action: "equipment.usage.create",
    entityType: "equipment_usage_log",
    entityId: payload.equipmentUsageLogId as string,
  }),
  "maintenance_schedule.created.v1": (payload) => ({
    action: "equipment.maintenance.create",
    entityType: "maintenance_schedule",
    entityId: payload.maintenanceScheduleId as string,
  }),
  "maintenance_work_order.created.v1": (payload) => ({
    action: "equipment.maintenance.create",
    entityType: "maintenance_work_order",
    entityId: payload.maintenanceWorkOrderId as string,
  }),
  "maintenance_work_order.updated.v1": (payload) => ({
    action: "equipment.maintenance.create",
    entityType: "maintenance_work_order",
    entityId: payload.maintenanceWorkOrderId as string,
  }),
  "equipment_inspection.created.v1": (payload) => ({
    action: "equipment.maintenance.create",
    entityType: "equipment_inspection",
    entityId: payload.equipmentInspectionId as string,
  }),
  // M12 Safety & Compliance (FR-SAFE-1..3).
  "safety_form_template.created.v1": (payload) => ({
    action: "safety.form_template.create",
    entityType: "safety_form_template",
    entityId: payload.safetyFormTemplateId as string,
  }),
  "safety_form.created.v1": (payload) => ({
    action: "safety.form.create",
    entityType: "safety_form",
    entityId: payload.safetyFormId as string,
  }),
  "incident.reported.v1": (payload) => ({
    action: "safety.incident.create",
    entityType: "incident",
    entityId: payload.incidentId as string,
  }),
  "incident.updated.v1": (payload) => ({
    action: "safety.incident.update",
    entityType: "incident",
    entityId: payload.incidentId as string,
  }),
  "certification.created.v1": (payload) => ({
    action: "safety.certification.create",
    entityType: "certification",
    entityId: payload.certificationId as string,
  }),
  "certification.updated.v1": (payload) => ({
    action: "safety.certification.update",
    entityType: "certification",
    entityId: payload.certificationId as string,
  }),
  // M14 Subcontractor Management (FR-SUB-1..3).
  "subcontractor.created.v1": (payload) => ({
    action: "subcontractor.subcontractor.create",
    entityType: "subcontractor",
    entityId: payload.subcontractorId as string,
  }),
  "subcontractor.updated.v1": (payload) => ({
    action: "subcontractor.subcontractor.update",
    entityType: "subcontractor",
    entityId: payload.subcontractorId as string,
  }),
  "subcontract.created.v1": (payload) => ({
    action: "subcontractor.subcontract.create",
    entityType: "subcontract",
    entityId: payload.subcontractId as string,
  }),
  "subcontract.approved.v1": (payload) => ({
    action: "subcontractor.subcontract.approve",
    entityType: "subcontract",
    entityId: payload.subcontractId as string,
  }),
  // FR-EST-6 sub bidding (owned by Estimating).
  "bid_package.created.v1": (payload) => ({
    action: "estimating.bid.create",
    entityType: "bid_package",
    entityId: payload.bidPackageId as string,
  }),
  "bid_invitation.created.v1": (payload) => ({
    action: "estimating.bid.create",
    entityType: "bid_invitation",
    entityId: payload.bidInvitationId as string,
  }),
  "bid.submitted.v1": (payload) => ({
    action: "estimating.bid.create",
    entityType: "bid",
    entityId: payload.bidId as string,
  }),
  // Supplier Portal (M15) + Finance invoices (FR-VEND-2, FR-SUB-3).
  "invoice.created.v1": (payload) => ({
    action: "finance.invoice.create",
    entityType: "invoice",
    entityId: payload.invoiceId as string,
  }),
  "invoice.approved.v1": (payload) => ({
    action: "finance.invoice.approve",
    entityType: "invoice",
    entityId: payload.invoiceId as string,
  }),
  "invoice.voided.v1": (payload) => ({
    action: "finance.invoice.approve",
    entityType: "invoice",
    entityId: payload.invoiceId as string,
  }),
  "invoice.paid.v1": (payload) => ({
    action: "finance.payment.create",
    entityType: "invoice",
    entityId: payload.invoiceId as string,
  }),
  "payment.created.v1": (payload) => ({
    action: "finance.payment.create",
    entityType: "payment",
    entityId: payload.paymentId as string,
  }),
  // Payment Applications (AIA, FR-FIN-4).
  "payment_application.created.v1": (payload) => ({
    action: "finance.payapp.create",
    entityType: "payment_application",
    entityId: payload.paymentApplicationId as string,
  }),
  "payment_application.approved.v1": (payload) => ({
    action: "finance.payapp.approve",
    entityType: "payment_application",
    entityId: payload.paymentApplicationId as string,
  }),
  "payment_application.voided.v1": (payload) => ({
    action: "finance.payapp.approve",
    entityType: "payment_application",
    entityId: payload.paymentApplicationId as string,
  }),
  "payment_application.pdf_generated.v1": (payload) => ({
    action: "finance.payapp.create",
    entityType: "payment_application",
    entityId: payload.paymentApplicationId as string,
  }),
  // entityType "estimate" (not "project") — unlike Budget's sub-resource
  // events, an estimate's own id is the natural audit query anchor ("show
  // me everything that happened to this estimate version").
  "estimate.created.v1": (payload) => ({
    action: "estimating.estimate.create",
    entityType: "estimate",
    entityId: payload.estimateId as string,
  }),
  "estimate.updated.v1": (payload) => ({
    action: "estimating.estimate.update",
    entityType: "estimate",
    entityId: payload.estimateId as string,
  }),
  "estimate_line.created.v1": (payload) => ({
    action: "estimating.estimate.update",
    entityType: "estimate",
    entityId: payload.estimateId as string,
  }),
  "estimate_line.updated.v1": (payload) => ({
    action: "estimating.estimate.update",
    entityType: "estimate",
    entityId: payload.estimateId as string,
  }),
  "estimate_line.deleted.v1": (payload) => ({
    action: "estimating.estimate.delete",
    entityType: "estimate",
    entityId: payload.estimateId as string,
  }),
  "cost_item.created.v1": (payload) => ({
    action: "estimating.costbook.manage",
    entityType: "cost_item",
    entityId: payload.costItemId as string,
  }),
  "cost_item.price_observed.v1": (payload) => ({
    action: "estimating.costbook.manage",
    entityType: "cost_item",
    entityId: payload.costItemId as string,
  }),
  "assembly.created.v1": (payload) => ({
    action: "estimating.costbook.manage",
    entityType: "assembly",
    entityId: payload.assemblyId as string,
  }),
  // entityType "change_order" (not "project") — same "the entity's own id
  // is the natural audit query anchor" reasoning as estimate.*.v1.
  "change_order.created.v1": (payload) => ({
    action: "finance.co.create",
    entityType: "change_order",
    entityId: payload.changeOrderId as string,
  }),
  "change_order.updated.v1": (payload) => ({
    action: "finance.co.update",
    entityType: "change_order",
    entityId: payload.changeOrderId as string,
  }),
  "change_order.approved.v1": (payload) => ({
    action: "finance.co.approve",
    entityType: "change_order",
    entityId: payload.changeOrderId as string,
  }),
  "change_order_line.created.v1": (payload) => ({
    action: "finance.co.update",
    entityType: "change_order",
    entityId: payload.changeOrderId as string,
  }),
  "change_order_line.updated.v1": (payload) => ({
    action: "finance.co.update",
    entityType: "change_order",
    entityId: payload.changeOrderId as string,
  }),
  "change_order_line.deleted.v1": (payload) => ({
    action: "finance.co.update",
    entityType: "change_order",
    entityId: payload.changeOrderId as string,
  }),
  "folder.created.v1": (payload) => ({
    action: "docs.document.create",
    entityType: "folder",
    entityId: payload.folderId as string,
  }),
  "document.created.v1": (payload) => ({
    action: "docs.document.create",
    entityType: "document",
    entityId: payload.documentId as string,
  }),
  "document.updated.v1": (payload) => ({
    action: "docs.document.update",
    entityType: "document",
    entityId: payload.documentId as string,
  }),
  // Uploading a version is gated by docs.document.update (see
  // DocumentsController.completeVersion), not .create — the action string
  // reuses that exact permission key, same convention as every other
  // mapper here.
  "document_version.created.v1": (payload) => ({
    action: "docs.document.update",
    entityType: "document",
    entityId: payload.documentId as string,
  }),
  "drawing_set.created.v1": (payload) => ({
    action: "docs.drawings.manage",
    entityType: "drawing_set",
    entityId: payload.drawingSetId as string,
  }),
  "drawing_set.published.v1": (payload) => ({
    action: "docs.drawings.manage",
    entityType: "drawing_set",
    entityId: payload.drawingSetId as string,
  }),
  "rfi.created.v1": (payload) => ({
    action: "docs.rfi.create",
    entityType: "rfi",
    entityId: payload.rfiId as string,
  }),
  "rfi.updated.v1": (payload) => ({
    action: "docs.rfi.update",
    entityType: "rfi",
    entityId: payload.rfiId as string,
  }),
  "submittal.created.v1": (payload) => ({
    action: "docs.submittal.create",
    entityType: "submittal",
    entityId: payload.submittalId as string,
  }),
  "submittal.updated.v1": (payload) => ({
    action: "docs.submittal.update",
    entityType: "submittal",
    entityId: payload.submittalId as string,
  }),
  "annotation.created.v1": (payload) => ({
    action: "docs.document.comment",
    entityType: "annotation",
    entityId: payload.annotationId as string,
  }),
  "task.created.v1": (payload) => ({
    action: "tasks.task.create",
    entityType: "task",
    entityId: payload.taskId as string,
  }),
  "task.updated.v1": (payload) => ({
    action: "tasks.task.update",
    entityType: "task",
    entityId: payload.taskId as string,
  }),
  "task.deleted.v1": (payload) => ({
    action: "tasks.task.delete",
    entityType: "task",
    entityId: payload.taskId as string,
  }),
  // M8 Field Operations (FR-FIELD-1/2). daily_report.updated.v1 reuses the
  // update permission even for the submit transition — see
  // DailyReportsService.update's own comment for why submit isn't a
  // separate action/permission.
  "daily_report.created.v1": (payload) => ({
    action: "field.daily_report.create",
    entityType: "daily_report",
    entityId: payload.dailyReportId as string,
  }),
  "daily_report.updated.v1": (payload) => ({
    action: "field.daily_report.update",
    entityType: "daily_report",
    entityId: payload.dailyReportId as string,
  }),
  "daily_report.submitted.v1": (payload) => ({
    action: "field.daily_report.update",
    entityType: "daily_report",
    entityId: payload.dailyReportId as string,
  }),
  // FR-FIELD-6: fires after DailyReportAiService writes the generated
  // narrative to daily_reports.ai_summary — same aiRunId linkage precedent
  // as photo.tagged.v1.
  "daily_report.ai_summary_generated.v1": (payload) => ({
    action: "field.daily_report.ai_summarize",
    entityType: "daily_report",
    entityId: payload.dailyReportId as string,
    aiRunId: payload.aiRunId as string,
  }),
  "time_entry.created.v1": (payload) => ({
    action: "field.time_entry.create",
    entityType: "time_entry",
    entityId: payload.timeEntryId as string,
  }),
  "time_entry.approved.v1": (payload) => ({
    action: "field.time_entry.approve",
    entityType: "time_entry",
    entityId: payload.timeEntryId as string,
  }),
  "photo.captured.v1": (payload) => ({
    action: "field.photo.create",
    entityType: "photo",
    entityId: payload.photoId as string,
  }),
  "photo.tagged.v1": (payload) => ({
    action: "field.photo.tag",
    entityType: "photo",
    entityId: payload.photoId as string,
    aiRunId: payload.aiRunId as string,
  }),
  // Only entity_type='task' has a real comment endpoint today (Tasks &
  // Punch, M6) — a future RFI/PO comment consumer will need this mapper
  // widened to branch on payload.entityType when it lands.
  "comment.created.v1": (payload) => ({
    action: "tasks.task.comment",
    entityType: payload.entityType as string,
    entityId: payload.entityId as string,
  }),
  // M7 Scheduling. schedule.created.v1 fires from inside the GET
  // /projects/{id}/schedule handler (lazy get-or-create — see
  // schedules.ts's schema comment), so its gating permission is
  // schedule.read, not schedule.update, unlike every other mutation here.
  "schedule.created.v1": (payload) => ({
    action: "schedule.read",
    entityType: "schedule",
    entityId: payload.scheduleId as string,
  }),
  "schedule_baseline.created.v1": (payload) => ({
    action: "schedule.baseline",
    entityType: "schedule",
    entityId: payload.scheduleId as string,
  }),
  "schedule_activity.created.v1": (payload) => ({
    action: "schedule.update",
    entityType: "schedule",
    entityId: payload.scheduleId as string,
  }),
  "schedule_activity.updated.v1": (payload) => ({
    action: "schedule.update",
    entityType: "schedule",
    entityId: payload.scheduleId as string,
  }),
  "schedule_activity.deleted.v1": (payload) => ({
    action: "schedule.update",
    entityType: "schedule",
    entityId: payload.scheduleId as string,
  }),
  "activity_dependency.replaced.v1": (payload) => ({
    action: "schedule.update",
    entityType: "schedule",
    entityId: payload.scheduleId as string,
  }),
  "schedule.recalculated.v1": (payload) => ({
    action: "schedule.update",
    entityType: "schedule",
    entityId: payload.scheduleId as string,
  }),
  "resource_assignment.created.v1": (payload) => ({
    action: "schedule.update",
    entityType: "resource_assignment",
    entityId: payload.resourceAssignmentId as string,
  }),
  "resource_assignment.deleted.v1": (payload) => ({
    action: "schedule.update",
    entityType: "resource_assignment",
    entityId: payload.resourceAssignmentId as string,
  }),
  // M13 Client Portal v1 (FR-CLIENT-2/3). client_selection.decided.v1
  // reuses the manage permission as its audit action even though it can
  // be reached via a client-portal share (no external principal has
  // client.selection.manage itself) — same convention as every other
  // mapper here: the action string names the permission that gates the
  // equivalent internal mutation.
  "client_selection.created.v1": (payload) => ({
    action: "client.selection.manage",
    entityType: "client_selection",
    entityId: payload.selectionId as string,
  }),
  "client_selection.updated.v1": (payload) => ({
    action: "client.selection.manage",
    entityType: "client_selection",
    entityId: payload.selectionId as string,
  }),
  "client_selection.decided.v1": (payload) => ({
    action: "client.selection.manage",
    entityType: "client_selection",
    entityId: payload.selectionId as string,
  }),
  "portal_message.created.v1": (payload) => ({
    action: "client.message.create",
    entityType: payload.entityType as string,
    entityId: payload.entityId as string,
  }),
  // M18 Imports/Exports (FR-PLAT-7). Only the two privileged actions get an
  // event at all — see events.ts's comment on why map/validate don't.
  "export_job.requested.v1": (payload) => ({
    action: "admin.export.manage",
    entityType: "export_job",
    entityId: payload.exportJobId as string,
  }),
  "import_job.committed.v1": (payload) => ({
    action: "admin.import.manage",
    entityType: "import_job",
    entityId: payload.importJobId as string,
  }),
  // M16 Reports (FR-EXEC-2, api.md §14).
  "report_definition.created.v1": (payload) => ({
    action: "reports.definition.create",
    entityType: "report_definition",
    entityId: payload.reportDefinitionId as string,
  }),
  "report_definition.updated.v1": (payload) => ({
    action: "reports.definition.update",
    entityType: "report_definition",
    entityId: payload.reportDefinitionId as string,
  }),
  // Reuses the "create" verb like payment_application.pdf_generated.v1 —
  // materializing a run's artifact is itself the audited creation, even
  // though the controller endpoint that triggers it only requires read.
  "report_run.completed.v1": (payload) => ({
    action: "reports.definition.create",
    entityType: "report_run",
    entityId: payload.reportRunId as string,
  }),
  // FR-PLAT-8 (api.md §10, M18 Platform/Admin).
  "accounting_connection.connected.v1": (payload) => ({
    action: "admin.integration.manage",
    entityType: "accounting_connection",
    entityId: payload.connectionId as string,
  }),
  "accounting_connection.disconnected.v1": (payload) => ({
    action: "admin.integration.manage",
    entityType: "accounting_connection",
    entityId: payload.connectionId as string,
  }),
  "accounting_sync_run.completed.v1": (payload) => ({
    action: "admin.integration.manage",
    entityType: "accounting_sync_run",
    entityId: payload.syncRunId as string,
  }),
  // api.md §16.3: outbound webhook endpoint CRUD is admin.webhook.manage-
  // gated (a registered endpoint receives every subscribed company event).
  "webhook_endpoint.created.v1": (payload) => ({
    action: "admin.webhook.manage",
    entityType: "webhook_endpoint",
    entityId: payload.webhookEndpointId as string,
  }),
  "webhook_endpoint.updated.v1": (payload) => ({
    action: "admin.webhook.manage",
    entityType: "webhook_endpoint",
    entityId: payload.webhookEndpointId as string,
  }),
  "webhook_endpoint.deleted.v1": (payload) => ({
    action: "admin.webhook.manage",
    entityType: "webhook_endpoint",
    entityId: payload.webhookEndpointId as string,
  }),
  // api.md §16.4: API key create/revoke are admin.apikey.manage-gated
  // (NFR-23 Public API GA).
  "api_key.created.v1": (payload) => ({
    action: "admin.apikey.manage",
    entityType: "api_key",
    entityId: payload.apiKeyId as string,
  }),
  "api_key.revoked.v1": (payload) => ({
    action: "admin.apikey.manage",
    entityType: "api_key",
    entityId: payload.apiKeyId as string,
  }),
  // api.md §2.1: connection admin is admin.sso.manage-gated; SCIM-driven
  // user lifecycle events aren't gated by a permission at all (the SCIM
  // token itself is the authorization) but are still fully audited, same
  // "AI has no side door" precedent (ai-spec.md §1) applied to
  // integration-attributed actions generally.
  "sso_connection.created.v1": (payload) => ({
    action: "admin.sso.manage",
    entityType: "sso_connection",
    entityId: payload.ssoConnectionId as string,
  }),
  "sso_connection.deleted.v1": (payload) => ({
    action: "admin.sso.manage",
    entityType: "sso_connection",
    entityId: payload.ssoConnectionId as string,
  }),
  "scim_user.provisioned.v1": (payload) => ({
    action: "admin.sso.manage",
    entityType: "user",
    entityId: payload.userId as string,
  }),
  "scim_user.deprovisioned.v1": (payload) => ({
    action: "admin.sso.manage",
    entityType: "user",
    entityId: payload.userId as string,
  }),
  // api.md §15.1 "Agent identities" — admin.agent.manage-gated lifecycle.
  "agent_identity.created.v1": (payload) => ({
    action: "admin.agent.manage",
    entityType: "agent_identity",
    entityId: payload.agentId as string,
  }),
  "agent_identity.paused.v1": (payload) => ({
    action: "admin.agent.manage",
    entityType: "agent_identity",
    entityId: payload.agentId as string,
  }),
  "agent_identity.resumed.v1": (payload) => ({
    action: "admin.agent.manage",
    entityType: "agent_identity",
    entityId: payload.agentId as string,
  }),
  "agent_identity.deleted.v1": (payload) => ({
    action: "admin.agent.manage",
    entityType: "agent_identity",
    entityId: payload.agentId as string,
  }),
  // api.md §15.4 "Compliance Agent" — fires after ComplianceAgentRunnerService
  // persists a new compliance_alerts row, same conditional-alert-row
  // audit shape as finance_alert.created.v1 above (no aiRunId — rule-only).
  "compliance_alert.raised.v1": (payload) => ({
    action: "compliance.alert.create",
    entityType: "compliance_alert",
    entityId: payload.complianceAlertId as string,
  }),
  // api.md §18 "Warranty & Closeout API" (M19, FR-CLOSE-1..5).
  "closeout_checklist_item.created.v1": (payload) => ({
    action: "closeout.checklist_item.create",
    entityType: "closeout_checklist_item",
    entityId: payload.checklistItemId as string,
  }),
  "closeout_checklist_item.updated.v1": (payload) => ({
    action: "closeout.checklist_item.update",
    entityType: "closeout_checklist_item",
    entityId: payload.checklistItemId as string,
  }),
  "closeout_package.assembled.v1": (payload) => ({
    action: "closeout.package.assemble",
    entityType: "closeout_package",
    entityId: payload.closeoutPackageId as string,
  }),
  "warranty.created.v1": (payload) => ({
    action: "closeout.warranty.create",
    entityType: "warranty",
    entityId: payload.warrantyId as string,
  }),
  "warranty.updated.v1": (payload) => ({
    action: "closeout.warranty.update",
    entityType: "warranty",
    entityId: payload.warrantyId as string,
  }),
  "warranty_claim.created.v1": (payload) => ({
    action: "closeout.claim.create",
    entityType: "warranty_claim",
    entityId: payload.warrantyClaimId as string,
  }),
  "warranty_claim.updated.v1": (payload) => ({
    action: "closeout.claim.update",
    entityType: "warranty_claim",
    entityId: payload.warrantyClaimId as string,
  }),
  // ai-spec.md §7.6 (Equipment AI) / FR-EQ-4 "fault patterns" — fires
  // after EquipmentFaultAlertsService persists a new equipment_fault_alerts
  // row. aiRunId is always present here (unlike finance_alert.created.v1's
  // conditional one): this event only fires once the AI has actually
  // confirmed a pattern, see equipment-fault-alerts.service.ts.
  "equipment_fault_alert.raised.v1": (payload) => ({
    action: "equipment.fault_alert.create",
    entityType: "equipment_fault_alert",
    entityId: payload.equipmentFaultAlertId as string,
    aiRunId: payload.aiRunId as string,
  }),
};

export function mapToAuditEntry(eventType: string, payload: unknown): AuditEntry | null {
  const mapper = mappers[eventType as EventType];
  if (!mapper) return null;
  return mapper(payload as Record<string, unknown>);
}
