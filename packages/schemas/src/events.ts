import { z } from "zod";
import { moneyAmountSchema, quantitySchema, uuidSchema } from "./common";

// architecture.md §8: "events are versioned JSON with a schema registry in
// packages/schemas (project.created.v1, changeorder.approved.v1, ...).
// Consumers must be idempotent (delivery is at-least-once); every event
// carries a dedupe_key."

export const companyRegisteredV1Schema = z.object({
  companyId: uuidSchema,
  companyName: z.string(),
  ownerUserId: uuidSchema,
});
export type CompanyRegisteredV1 = z.infer<typeof companyRegisteredV1Schema>;

// Roadmap Phase 2 "Second locale + metric units (NFR-30 activation)":
// PATCH /admin/company (api.md §15, admin.company.manage) — a privileged
// tenant-settings change, same "generic updated event with changedFields"
// shape as document.updated.v1/project.updated.v1.
export const companyUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type CompanyUpdatedV1 = z.infer<typeof companyUpdatedV1Schema>;

// PATCH /auth/me/preferences (api.md §2) — a self-service change to the
// caller's own row, not a privileged admin action, so (unlike
// company.updated.v1) this is deliberately NOT wired into the audit
// action map below — same precedent as PUT /notification-preferences,
// which is also self-service and also unaudited.
export const userPreferencesUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  userId: uuidSchema,
  locale: z.string(),
});
export type UserPreferencesUpdatedV1 = z.infer<typeof userPreferencesUpdatedV1Schema>;

export const userInvitedV1Schema = z.object({
  companyId: uuidSchema,
  userId: uuidSchema,
  email: z.string().email(),
});
export type UserInvitedV1 = z.infer<typeof userInvitedV1Schema>;

export const roleAssignedV1Schema = z.object({
  companyId: uuidSchema,
  userId: uuidSchema,
  roleId: uuidSchema,
  scopeType: z.enum(["company", "project"]),
  projectId: uuidSchema.optional(),
});
export type RoleAssignedV1 = z.infer<typeof roleAssignedV1Schema>;

// The following five round out FR-RBAC-4 ("every grant/revoke/elevation is
// audited") — role.assigned.v1/user.invited.v1 above were the first two
// RBAC mutations wired to the outbox; these cover the rest.

export const roleCreatedV1Schema = z.object({
  companyId: uuidSchema,
  roleId: uuidSchema,
  roleName: z.string(),
});
export type RoleCreatedV1 = z.infer<typeof roleCreatedV1Schema>;

export const permissionGrantedV1Schema = z.object({
  companyId: uuidSchema,
  roleId: uuidSchema,
  permissionKey: z.string(),
});
export type PermissionGrantedV1 = z.infer<typeof permissionGrantedV1Schema>;

export const permissionRevokedV1Schema = z.object({
  companyId: uuidSchema,
  roleId: uuidSchema,
  permissionKey: z.string(),
});
export type PermissionRevokedV1 = z.infer<typeof permissionRevokedV1Schema>;

export const companyUserRemovedV1Schema = z.object({
  companyId: uuidSchema,
  userId: uuidSchema,
});
export type CompanyUserRemovedV1 = z.infer<typeof companyUserRemovedV1Schema>;

export const userRoleRevokedV1Schema = z.object({
  companyId: uuidSchema,
  userId: uuidSchema,
  roleId: uuidSchema,
});
export type UserRoleRevokedV1 = z.infer<typeof userRoleRevokedV1Schema>;

// spec.md §10.2 (Segregation of duties): "permission changes support
// maker/checker workflows for enterprise tenants." When a tenant's
// companies.settings.enforceMakerChecker is on, assign/revoke-role and
// grant/revoke-permission are queued here instead of applying immediately
// — approved.v1 carries both requestedBy (the maker) and the outbox
// envelope's own actorId (the checker who approved) for a full audit
// trail without a new permission type (architecture.md §12).
export const permissionChangeRequestActionTypeSchema = z.enum([
  "assign_role",
  "revoke_role",
  "grant_permission",
  "revoke_permission",
]);
export type PermissionChangeRequestActionType = z.infer<typeof permissionChangeRequestActionTypeSchema>;

export const permissionChangeRequestCreatedV1Schema = z.object({
  companyId: uuidSchema,
  requestId: uuidSchema,
  actionType: permissionChangeRequestActionTypeSchema,
  requestedBy: uuidSchema,
});
export type PermissionChangeRequestCreatedV1 = z.infer<typeof permissionChangeRequestCreatedV1Schema>;

export const permissionChangeRequestApprovedV1Schema = z.object({
  companyId: uuidSchema,
  requestId: uuidSchema,
  actionType: permissionChangeRequestActionTypeSchema,
  requestedBy: uuidSchema,
});
export type PermissionChangeRequestApprovedV1 = z.infer<typeof permissionChangeRequestApprovedV1Schema>;

export const permissionChangeRequestRejectedV1Schema = z.object({
  companyId: uuidSchema,
  requestId: uuidSchema,
  actionType: permissionChangeRequestActionTypeSchema,
  requestedBy: uuidSchema,
});
export type PermissionChangeRequestRejectedV1 = z.infer<typeof permissionChangeRequestRejectedV1Schema>;

// M13 Client Portal foundation (FR-RBAC-3). external_share.created.v1
// covers a grant to any audience (client/sub/supplier) — one generic event
// rather than per-audience variants, same "one event, a discriminator
// field" reasoning as task.created.v1's `kind`.
export const externalShareCreatedV1Schema = z.object({
  companyId: uuidSchema,
  shareId: uuidSchema,
  principalUserId: uuidSchema,
  audience: z.enum(["client", "subcontractor", "supplier"]),
  entityType: z.string(),
  entityId: uuidSchema,
  access: z.enum(["view", "approve", "comment"]),
});
export type ExternalShareCreatedV1 = z.infer<typeof externalShareCreatedV1Schema>;

// M13 Client Portal v1 (FR-CLIENT-2/3). client_selection.updated.v1 is the
// generic "header changed" event, same reasoning as project.updated.v1.
// client_selection.decided.v1 carries costDeltaAmount (selected option's
// cost minus the allowance) so a future consumer can act on cost-impacting
// decisions — see client_portal.ts's schema comment on why that consumer
// isn't built yet (no cost_code_id on this table).
export const clientSelectionCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  selectionId: uuidSchema,
  title: z.string(),
});
export type ClientSelectionCreatedV1 = z.infer<typeof clientSelectionCreatedV1Schema>;

export const clientSelectionUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  selectionId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type ClientSelectionUpdatedV1 = z.infer<typeof clientSelectionUpdatedV1Schema>;

export const clientSelectionDecidedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  selectionId: uuidSchema,
  selectedOption: z.string(),
  costDeltaAmount: z.string(),
});
export type ClientSelectionDecidedV1 = z.infer<typeof clientSelectionDecidedV1Schema>;

// entity_type/entity_id name whatever the thread is attached to (v1 only
// ever uses "project", but the table itself is generic — same "polymorphic
// stream" precedent as comment.created.v1).
export const portalMessageCreatedV1Schema = z.object({
  companyId: uuidSchema,
  entityType: z.string(),
  entityId: uuidSchema,
  messageId: uuidSchema,
  audience: z.enum(["client", "subcontractor", "supplier"]),
});
export type PortalMessageCreatedV1 = z.infer<typeof portalMessageCreatedV1Schema>;

// architecture.md §13's file pipeline: uploaded (client completed the
// presigned upload) and scan-completed (the processing worker finished
// virus-scanning + thumbnailing) are separate events since they happen at
// different times and different actors (a human upload vs. the worker).
export const fileUploadedV1Schema = z.object({
  companyId: uuidSchema,
  fileId: uuidSchema,
  objectKey: z.string(),
  originalFilename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type FileUploadedV1 = z.infer<typeof fileUploadedV1Schema>;

export const fileScanCompletedV1Schema = z.object({
  companyId: uuidSchema,
  fileId: uuidSchema,
  status: z.enum(["clean", "infected", "scan_failed"]),
  signature: z.string().optional(),
});
export type FileScanCompletedV1 = z.infer<typeof fileScanCompletedV1Schema>;

// M4 Project Management (FR-PM-1). Field-level edits and status
// transitions share one project.updated.v1 event (a `changedFields` list)
// rather than a proliferation of near-duplicate types — unlike RBAC's
// grant/revoke events, these aren't individually permission-gated actions
// that need their own audit action string.
export const projectCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  name: z.string(),
  code: z.string(),
  templateId: uuidSchema.nullable(),
});
export type ProjectCreatedV1 = z.infer<typeof projectCreatedV1Schema>;

export const projectUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type ProjectUpdatedV1 = z.infer<typeof projectUpdatedV1Schema>;

export const projectDeletedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
});
export type ProjectDeletedV1 = z.infer<typeof projectDeletedV1Schema>;

export const projectMemberAddedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  userId: uuidSchema,
});
export type ProjectMemberAddedV1 = z.infer<typeof projectMemberAddedV1Schema>;

export const projectMemberRemovedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  userId: uuidSchema,
});
export type ProjectMemberRemovedV1 = z.infer<typeof projectMemberRemovedV1Schema>;

export const costCodeCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  costCodeId: uuidSchema,
  code: z.string(),
});
export type CostCodeCreatedV1 = z.infer<typeof costCodeCreatedV1Schema>;

export const milestoneCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  milestoneId: uuidSchema,
  name: z.string(),
});
export type MilestoneCreatedV1 = z.infer<typeof milestoneCreatedV1Schema>;

// M9 Financials core (FR-FIN-1). budget_line.updated.v1 covers both a
// direct PATCH and the actual/forecast maintenance that happens when a
// cost transaction posts — same "one generic updated event" reasoning as
// project.updated.v1.
export const budgetCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  budgetId: uuidSchema,
});
export type BudgetCreatedV1 = z.infer<typeof budgetCreatedV1Schema>;

export const budgetLineCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  budgetId: uuidSchema,
  budgetLineId: uuidSchema,
  costCodeId: uuidSchema,
});
export type BudgetLineCreatedV1 = z.infer<typeof budgetLineCreatedV1Schema>;

export const budgetLineUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  budgetId: uuidSchema,
  budgetLineId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type BudgetLineUpdatedV1 = z.infer<typeof budgetLineUpdatedV1Schema>;

export const costTransactionPostedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  costCodeId: uuidSchema,
  costTransactionId: uuidSchema,
  source: z.string(),
  amount: z.string(),
});
export type CostTransactionPostedV1 = z.infer<typeof costTransactionPostedV1Schema>;

// FR-FIN-6 (ai-spec.md §7.10 Financial AI): fired after MarginErosionService
// persists a new finance_alerts row. aiRunId is nullable — the rule always
// fires the alert; the AI causal-decomposition explanation is a best-effort
// enrichment that can fail (budget exhausted, provider error) without ever
// blocking the alert itself.
export const financeAlertCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  financeAlertId: uuidSchema,
  severity: z.enum(["warning", "critical"]),
  aiRunId: uuidSchema.nullable(),
});
export type FinanceAlertCreatedV1 = z.infer<typeof financeAlertCreatedV1Schema>;

// M1 CRM & Pre-Construction (FR-CRM-1). One created event covers both
// contacts and contact_companies producers each emit their own — same
// per-resource-type event convention as every other module.
export const contactCompanyCreatedV1Schema = z.object({
  companyId: uuidSchema,
  contactCompanyId: uuidSchema,
});
export type ContactCompanyCreatedV1 = z.infer<typeof contactCompanyCreatedV1Schema>;

export const contactCreatedV1Schema = z.object({
  companyId: uuidSchema,
  contactId: uuidSchema,
});
export type ContactCreatedV1 = z.infer<typeof contactCreatedV1Schema>;

export const pipelineStageCreatedV1Schema = z.object({
  companyId: uuidSchema,
  pipelineStageId: uuidSchema,
});
export type PipelineStageCreatedV1 = z.infer<typeof pipelineStageCreatedV1Schema>;

export const opportunityCreatedV1Schema = z.object({
  companyId: uuidSchema,
  opportunityId: uuidSchema,
});
export type OpportunityCreatedV1 = z.infer<typeof opportunityCreatedV1Schema>;

// Stage moves, header edits, and win/lose transitions all maintain the
// same opportunity row — one generic updated event with changedFields,
// same "one event, changedFields tells you what" reasoning as
// project.updated.v1 (api.md §4: "Stage moves audited").
export const opportunityUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  opportunityId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type OpportunityUpdatedV1 = z.infer<typeof opportunityUpdatedV1Schema>;

// FR-CRM-4: "Atomic: marks won, creates project." Carries wonProjectId so
// consumers (notifications, projections) can link straight to the new
// project without a second lookup.
export const opportunityWonV1Schema = z.object({
  companyId: uuidSchema,
  opportunityId: uuidSchema,
  wonProjectId: uuidSchema,
});
export type OpportunityWonV1 = z.infer<typeof opportunityWonV1Schema>;

export const opportunityLostV1Schema = z.object({
  companyId: uuidSchema,
  opportunityId: uuidSchema,
  lostReason: z.string(),
});
export type OpportunityLostV1 = z.infer<typeof opportunityLostV1Schema>;

export const activityCreatedV1Schema = z.object({
  companyId: uuidSchema,
  activityId: uuidSchema,
  entityType: z.string(),
  entityId: uuidSchema,
});
export type ActivityCreatedV1 = z.infer<typeof activityCreatedV1Schema>;

// M5 Procurement & Purchasing (FR-PROC-1..4).
export const supplierCreatedV1Schema = z.object({
  companyId: uuidSchema,
  supplierId: uuidSchema,
});
export type SupplierCreatedV1 = z.infer<typeof supplierCreatedV1Schema>;

// Procurement AI (ai-spec.md §7.4, FR-PROC-5): supplier scoring recompute.
export const supplierRatedV1Schema = z.object({
  companyId: uuidSchema,
  supplierId: uuidSchema,
});
export type SupplierRatedV1 = z.infer<typeof supplierRatedV1Schema>;

export const purchaseOrderCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  purchaseOrderId: uuidSchema,
  number: z.number().int(),
});
export type PurchaseOrderCreatedV1 = z.infer<typeof purchaseOrderCreatedV1Schema>;

// Header edits and status transitions (submit/send/cancel) all maintain
// the same PO row — one generic updated event with changedFields, same
// "one event, changedFields tells you what" convention as
// opportunity.updated.v1/project.updated.v1. Approval gets its own event
// (below) since it's the one transition with a real side effect to
// broadcast (the commitment write).
export const purchaseOrderUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  purchaseOrderId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type PurchaseOrderUpdatedV1 = z.infer<typeof purchaseOrderUpdatedV1Schema>;

// FR-PROC-3: "Approval -> commitments row (same transaction)." Mirrors
// change_order.approved.v1's reasoning for carrying the amount so
// consumers (projections, notifications) don't need a second lookup.
export const purchaseOrderApprovedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  purchaseOrderId: uuidSchema,
  totalAmount: moneyAmountSchema,
});
export type PurchaseOrderApprovedV1 = z.infer<typeof purchaseOrderApprovedV1Schema>;

export const purchaseOrderLineCreatedV1Schema = z.object({
  companyId: uuidSchema,
  purchaseOrderId: uuidSchema,
  purchaseOrderLineId: uuidSchema,
});
export type PurchaseOrderLineCreatedV1 = z.infer<typeof purchaseOrderLineCreatedV1Schema>;

export const rfqCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  rfqId: uuidSchema,
  number: z.number().int(),
});
export type RfqCreatedV1 = z.infer<typeof rfqCreatedV1Schema>;

export const supplierQuoteCreatedV1Schema = z.object({
  companyId: uuidSchema,
  rfqId: uuidSchema,
  rfqLineId: uuidSchema,
  supplierQuoteId: uuidSchema,
  supplierId: uuidSchema,
});
export type SupplierQuoteCreatedV1 = z.infer<typeof supplierQuoteCreatedV1Schema>;

// FR-PROC-4: delivery receipt. No stock/3-way-match side effect happened
// when this was first written (Inventory didn't exist yet) — the stock
// receipt is now wired (Inventory M10 row, DeliveriesService); the 3-way-
// match half stays flagged (no invoices/AP module exists).
export const deliveryCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  purchaseOrderId: uuidSchema,
  deliveryId: uuidSchema,
});
export type DeliveryCreatedV1 = z.infer<typeof deliveryCreatedV1Schema>;

// M10 Inventory & Materials (FR-INV-1..2).
export const inventoryItemCreatedV1Schema = z.object({
  companyId: uuidSchema,
  inventoryItemId: uuidSchema,
});
export type InventoryItemCreatedV1 = z.infer<typeof inventoryItemCreatedV1Schema>;

export const inventoryLocationCreatedV1Schema = z.object({
  companyId: uuidSchema,
  inventoryLocationId: uuidSchema,
});
export type InventoryLocationCreatedV1 = z.infer<typeof inventoryLocationCreatedV1Schema>;

// One event per ledger post — stock_levels is a maintained aggregate
// cache of this ledger, same "the ledger post gets the event, the
// rollup doesn't" precedent as cost_transaction.posted.v1 (no separate
// budget_lines event fires from CostTransactionsService either).
export const stockMovementPostedV1Schema = z.object({
  companyId: uuidSchema,
  stockMovementId: uuidSchema,
  itemId: uuidSchema,
  kind: z.enum(["receipt", "issue", "transfer_out", "transfer_in", "adjustment", "return"]),
  qty: quantitySchema,
});
export type StockMovementPostedV1 = z.infer<typeof stockMovementPostedV1Schema>;

// M11 Equipment & Asset Management (FR-EQ-1..3).
export const equipmentCreatedV1Schema = z.object({
  companyId: uuidSchema,
  equipmentId: uuidSchema,
});
export type EquipmentCreatedV1 = z.infer<typeof equipmentCreatedV1Schema>;

// FR-EQ-1: assignment create/end both maintain the equipment's own
// status/current_project_id — one generic event with changedFields, same
// "one event, changedFields tells you what" convention as
// opportunity.updated.v1.
export const equipmentAssignmentCreatedV1Schema = z.object({
  companyId: uuidSchema,
  equipmentId: uuidSchema,
  equipmentAssignmentId: uuidSchema,
  projectId: uuidSchema,
});
export type EquipmentAssignmentCreatedV1 = z.infer<typeof equipmentAssignmentCreatedV1Schema>;

export const equipmentAssignmentEndedV1Schema = z.object({
  companyId: uuidSchema,
  equipmentId: uuidSchema,
  equipmentAssignmentId: uuidSchema,
});
export type EquipmentAssignmentEndedV1 = z.infer<typeof equipmentAssignmentEndedV1Schema>;

export const equipmentUsageLogCreatedV1Schema = z.object({
  companyId: uuidSchema,
  equipmentId: uuidSchema,
  equipmentUsageLogId: uuidSchema,
});
export type EquipmentUsageLogCreatedV1 = z.infer<typeof equipmentUsageLogCreatedV1Schema>;

export const maintenanceScheduleCreatedV1Schema = z.object({
  companyId: uuidSchema,
  equipmentId: uuidSchema,
  maintenanceScheduleId: uuidSchema,
});
export type MaintenanceScheduleCreatedV1 = z.infer<typeof maintenanceScheduleCreatedV1Schema>;

export const maintenanceWorkOrderCreatedV1Schema = z.object({
  companyId: uuidSchema,
  equipmentId: uuidSchema,
  maintenanceWorkOrderId: uuidSchema,
});
export type MaintenanceWorkOrderCreatedV1 = z.infer<typeof maintenanceWorkOrderCreatedV1Schema>;

export const maintenanceWorkOrderUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  equipmentId: uuidSchema,
  maintenanceWorkOrderId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type MaintenanceWorkOrderUpdatedV1 = z.infer<typeof maintenanceWorkOrderUpdatedV1Schema>;

export const equipmentInspectionCreatedV1Schema = z.object({
  companyId: uuidSchema,
  equipmentId: uuidSchema,
  equipmentInspectionId: uuidSchema,
  passed: z.boolean(),
});
export type EquipmentInspectionCreatedV1 = z.infer<typeof equipmentInspectionCreatedV1Schema>;

// M12 Safety & Compliance (FR-SAFE-1..3). "incident.reported.v1" matches
// api.md §16's own event-catalog example list verbatim ("incident.reported")
// rather than the usual "created" verb every other entity uses.
export const safetyFormTemplateCreatedV1Schema = z.object({
  companyId: uuidSchema,
  safetyFormTemplateId: uuidSchema,
});
export type SafetyFormTemplateCreatedV1 = z.infer<typeof safetyFormTemplateCreatedV1Schema>;

export const safetyFormCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  safetyFormId: uuidSchema,
  templateId: uuidSchema,
});
export type SafetyFormCreatedV1 = z.infer<typeof safetyFormCreatedV1Schema>;

export const incidentReportedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  incidentId: uuidSchema,
  kind: z.enum(["incident", "near_miss", "observation"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
});
export type IncidentReportedV1 = z.infer<typeof incidentReportedV1Schema>;

export const incidentUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  incidentId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type IncidentUpdatedV1 = z.infer<typeof incidentUpdatedV1Schema>;

export const certificationCreatedV1Schema = z.object({
  companyId: uuidSchema,
  certificationId: uuidSchema,
});
export type CertificationCreatedV1 = z.infer<typeof certificationCreatedV1Schema>;

export const certificationUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  certificationId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type CertificationUpdatedV1 = z.infer<typeof certificationUpdatedV1Schema>;

// M14 Subcontractor Management (FR-SUB-1..3).
export const subcontractorCreatedV1Schema = z.object({
  companyId: uuidSchema,
  subcontractorId: uuidSchema,
});
export type SubcontractorCreatedV1 = z.infer<typeof subcontractorCreatedV1Schema>;

export const subcontractorUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  subcontractorId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type SubcontractorUpdatedV1 = z.infer<typeof subcontractorUpdatedV1Schema>;

export const subcontractCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  subcontractId: uuidSchema,
  subcontractorId: uuidSchema,
});
export type SubcontractCreatedV1 = z.infer<typeof subcontractCreatedV1Schema>;

// FR-SUB-3: "approval creates commitments (mirror of PO flow)" — same
// shape as purchase_order.approved.v1.
export const subcontractApprovedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  subcontractId: uuidSchema,
});
export type SubcontractApprovedV1 = z.infer<typeof subcontractApprovedV1Schema>;

// FR-EST-6 sub bidding (owned by Estimating, api.md §5 `estimating.bid.*`
// — see estimates.ts schema file's doc comment on bidPackages).
export const bidPackageCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  bidPackageId: uuidSchema,
});
export type BidPackageCreatedV1 = z.infer<typeof bidPackageCreatedV1Schema>;

export const bidInvitationCreatedV1Schema = z.object({
  companyId: uuidSchema,
  bidPackageId: uuidSchema,
  bidInvitationId: uuidSchema,
  subcontractorId: uuidSchema,
});
export type BidInvitationCreatedV1 = z.infer<typeof bidInvitationCreatedV1Schema>;

export const bidSubmittedV1Schema = z.object({
  companyId: uuidSchema,
  bidInvitationId: uuidSchema,
  bidId: uuidSchema,
  amount: moneyAmountSchema,
});
export type BidSubmittedV1 = z.infer<typeof bidSubmittedV1Schema>;

// Supplier Portal (M15) + Finance invoices (database.md §11, api.md §10,
// FR-VEND-2/FR-SUB-3). direction/counterpartyType travel on the event so
// consumers (audit, future AP dashboards) don't need a lookup to know
// which pipeline (AP vs AR, supplier vs subcontractor vs client) fired.
export const invoiceCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema.nullable(),
  invoiceId: uuidSchema,
  direction: z.enum(["payable", "receivable"]),
  counterpartyType: z.enum(["client", "supplier", "subcontractor"]),
});
export type InvoiceCreatedV1 = z.infer<typeof invoiceCreatedV1Schema>;

export const invoiceApprovedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema.nullable(),
  invoiceId: uuidSchema,
  totalAmount: moneyAmountSchema,
  matchStatus: z.string().nullable(),
});
export type InvoiceApprovedV1 = z.infer<typeof invoiceApprovedV1Schema>;

export const invoiceVoidedV1Schema = z.object({
  companyId: uuidSchema,
  invoiceId: uuidSchema,
});
export type InvoiceVoidedV1 = z.infer<typeof invoiceVoidedV1Schema>;

export const invoicePaidV1Schema = z.object({
  companyId: uuidSchema,
  invoiceId: uuidSchema,
  paidAmount: moneyAmountSchema,
});
export type InvoicePaidV1 = z.infer<typeof invoicePaidV1Schema>;

export const paymentCreatedV1Schema = z.object({
  companyId: uuidSchema,
  invoiceId: uuidSchema,
  paymentId: uuidSchema,
  amount: moneyAmountSchema,
});
export type PaymentCreatedV1 = z.infer<typeof paymentCreatedV1Schema>;

// Payment Applications (FR-FIN-4, database.md §11, api.md §10).
export const paymentApplicationCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  paymentApplicationId: uuidSchema,
  periodNumber: z.number().int(),
});
export type PaymentApplicationCreatedV1 = z.infer<typeof paymentApplicationCreatedV1Schema>;

export const paymentApplicationApprovedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  paymentApplicationId: uuidSchema,
  invoiceId: uuidSchema,
  currentPaymentDue: moneyAmountSchema,
});
export type PaymentApplicationApprovedV1 = z.infer<typeof paymentApplicationApprovedV1Schema>;

export const paymentApplicationVoidedV1Schema = z.object({
  companyId: uuidSchema,
  paymentApplicationId: uuidSchema,
});
export type PaymentApplicationVoidedV1 = z.infer<typeof paymentApplicationVoidedV1Schema>;

export const paymentApplicationPdfGeneratedV1Schema = z.object({
  companyId: uuidSchema,
  paymentApplicationId: uuidSchema,
  documentVersionId: uuidSchema,
});
export type PaymentApplicationPdfGeneratedV1 = z.infer<typeof paymentApplicationPdfGeneratedV1Schema>;

// M2 Estimating (FR-EST-1..5). estimate.created.v1 covers both a brand-new
// estimate and a new version (FR-EST-4 versions are new rows) — same
// "one create event regardless of how the row came to exist" reasoning as
// project.created.v1.
export const estimateCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  estimateId: uuidSchema,
  version: z.number().int(),
});
export type EstimateCreatedV1 = z.infer<typeof estimateCreatedV1Schema>;

export const estimateUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  estimateId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type EstimateUpdatedV1 = z.infer<typeof estimateUpdatedV1Schema>;

export const estimateLineCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  estimateId: uuidSchema,
  estimateLineId: uuidSchema,
});
export type EstimateLineCreatedV1 = z.infer<typeof estimateLineCreatedV1Schema>;

export const estimateLineUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  estimateId: uuidSchema,
  estimateLineId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type EstimateLineUpdatedV1 = z.infer<typeof estimateLineUpdatedV1Schema>;

export const estimateLineDeletedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  estimateId: uuidSchema,
  estimateLineId: uuidSchema,
});
export type EstimateLineDeletedV1 = z.infer<typeof estimateLineDeletedV1Schema>;

// Cost book entities are tenant-wide, not project-scoped, so their events
// carry no projectId (unlike the estimate.*/estimate_line.* events above).
export const costItemCreatedV1Schema = z.object({
  companyId: uuidSchema,
  costItemId: uuidSchema,
  code: z.string(),
});
export type CostItemCreatedV1 = z.infer<typeof costItemCreatedV1Schema>;

export const costItemPriceObservedV1Schema = z.object({
  companyId: uuidSchema,
  costItemId: uuidSchema,
  unitCostAmount: z.string(),
  source: z.string(),
});
export type CostItemPriceObservedV1 = z.infer<typeof costItemPriceObservedV1Schema>;

export const assemblyCreatedV1Schema = z.object({
  companyId: uuidSchema,
  assemblyId: uuidSchema,
  code: z.string(),
});
export type AssemblyCreatedV1 = z.infer<typeof assemblyCreatedV1Schema>;

// M9 Change Orders (FR-FIN-2). change_order.updated.v1 is the generic
// "something about the header or status changed" event — covers header
// edits, submit-to-client, reject, and void — same "one generic updated
// event" reasoning as project.updated.v1/budget_line.updated.v1.
// change_order.approved.v1 is broken out separately because it's the one
// event that actually carries the propagation payload a future Scheduling
// module needs (schedule_impact_days) — FR-FIN-2's "schedule impact event".
export const changeOrderCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  changeOrderId: uuidSchema,
  number: z.number().int(),
});
export type ChangeOrderCreatedV1 = z.infer<typeof changeOrderCreatedV1Schema>;

export const changeOrderUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  changeOrderId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type ChangeOrderUpdatedV1 = z.infer<typeof changeOrderUpdatedV1Schema>;

export const changeOrderApprovedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  changeOrderId: uuidSchema,
  costImpactAmount: z.string(),
  scheduleImpactDays: z.number().int(),
});
export type ChangeOrderApprovedV1 = z.infer<typeof changeOrderApprovedV1Schema>;

export const changeOrderLineCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  changeOrderId: uuidSchema,
  changeOrderLineId: uuidSchema,
});
export type ChangeOrderLineCreatedV1 = z.infer<typeof changeOrderLineCreatedV1Schema>;

export const changeOrderLineUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  changeOrderId: uuidSchema,
  changeOrderLineId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type ChangeOrderLineUpdatedV1 = z.infer<typeof changeOrderLineUpdatedV1Schema>;

export const changeOrderLineDeletedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  changeOrderId: uuidSchema,
  changeOrderLineId: uuidSchema,
});
export type ChangeOrderLineDeletedV1 = z.infer<typeof changeOrderLineDeletedV1Schema>;

// M3 Documents (FR-DOC-1/2/5). document.updated.v1 is the generic
// "something about the header changed" event — covers rename/move/category
// and the current_version_id pointer moving — same "one generic updated
// event" reasoning as project.updated.v1. document_version rows are
// immutable once created (no updated/deleted event needed).
export const folderCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  folderId: uuidSchema,
  name: z.string(),
});
export type FolderCreatedV1 = z.infer<typeof folderCreatedV1Schema>;

export const documentCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  name: z.string(),
  category: z.string(),
});
export type DocumentCreatedV1 = z.infer<typeof documentCreatedV1Schema>;

export const documentUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type DocumentUpdatedV1 = z.infer<typeof documentUpdatedV1Schema>;

export const documentVersionCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  documentVersionId: uuidSchema,
  versionNo: z.number().int(),
});
export type DocumentVersionCreatedV1 = z.infer<typeof documentVersionCreatedV1Schema>;

export const drawingSetCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  drawingSetId: uuidSchema,
  name: z.string(),
});
export type DrawingSetCreatedV1 = z.infer<typeof drawingSetCreatedV1Schema>;

// FR-DOC-5: the signal a future Mobile/Sync module's "GET /sync/working-set"
// needs to know which set is now the field working set.
export const drawingSetPublishedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  drawingSetId: uuidSchema,
});
export type DrawingSetPublishedV1 = z.infer<typeof drawingSetPublishedV1Schema>;

// M3 RFIs (FR-DOC-4). rfi.updated.v1 is the generic "something about the
// header changed" event — covers header edits and every status transition
// (open/answer/close/void) — same "one generic updated event" reasoning as
// project.updated.v1.
export const rfiCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  rfiId: uuidSchema,
  number: z.number().int(),
});
export type RfiCreatedV1 = z.infer<typeof rfiCreatedV1Schema>;

export const rfiUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  rfiId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type RfiUpdatedV1 = z.infer<typeof rfiUpdatedV1Schema>;

// M3 Submittals (FR-DOC-4), roadmap.md "Submittals + annotations + drawing
// compare". submittal.updated.v1 is the generic "header or status changed"
// event — same "one generic updated event" reasoning as rfi.updated.v1.
export const submittalCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  submittalId: uuidSchema,
  number: z.number().int(),
});
export type SubmittalCreatedV1 = z.infer<typeof submittalCreatedV1Schema>;

export const submittalUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  submittalId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type SubmittalUpdatedV1 = z.infer<typeof submittalUpdatedV1Schema>;

// M3 Annotations (FR-DOC-3): markups on document_versions.
export const annotationCreatedV1Schema = z.object({
  companyId: uuidSchema,
  documentVersionId: uuidSchema,
  annotationId: uuidSchema,
});
export type AnnotationCreatedV1 = z.infer<typeof annotationCreatedV1Schema>;

// M6 Tasks & Punch (FR-TASK-1..3). task.updated.v1 is the generic "header
// or status changed" event — same "one generic updated event" reasoning as
// project.updated.v1. Punch items are kind='punch' on the same table
// (database.md §15), so no separate punch.*.v1 events exist.
export const taskCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema,
  kind: z.string(),
});
export type TaskCreatedV1 = z.infer<typeof taskCreatedV1Schema>;

export const taskUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type TaskUpdatedV1 = z.infer<typeof taskUpdatedV1Schema>;

export const taskDeletedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema,
});
export type TaskDeletedV1 = z.infer<typeof taskDeletedV1Schema>;

// M8 Field Operations (FR-FIELD-1/2). daily_report.updated.v1 covers both
// header edits and the draft -> submitted transition — same "one generic
// updated event, changedFields tells you what" reasoning as task.updated.v1.
export const dailyReportCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  dailyReportId: uuidSchema,
});
export type DailyReportCreatedV1 = z.infer<typeof dailyReportCreatedV1Schema>;

export const dailyReportUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  dailyReportId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type DailyReportUpdatedV1 = z.infer<typeof dailyReportUpdatedV1Schema>;

export const dailyReportSubmittedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  dailyReportId: uuidSchema,
});
export type DailyReportSubmittedV1 = z.infer<typeof dailyReportSubmittedV1Schema>;

// Daily-report AI summary (FR-FIELD-6, api.md §9's ai-summary GET). Fired
// after DailyReportAiService writes the generated narrative to
// daily_reports.ai_summary — carries aiRunId for the same audit_log
// linkage precedent photo.tagged.v1 established (ai-spec §6: "every
// execution -> audit_log with ai_run_id").
export const dailyReportAiSummaryGeneratedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  dailyReportId: uuidSchema,
  aiRunId: uuidSchema,
});
export type DailyReportAiSummaryGeneratedV1 = z.infer<typeof dailyReportAiSummaryGeneratedV1Schema>;

export const timeEntryCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  timeEntryId: uuidSchema,
});
export type TimeEntryCreatedV1 = z.infer<typeof timeEntryCreatedV1Schema>;

// FR-FIELD-2: "Approval -> cost_transactions at labor rate." costTransactionId
// is null when no hourly rate is configured for the worker (documented gap,
// see company_users.hourlyRateAmount's schema comment) — approval still
// succeeds, it just doesn't post a cost transaction.
export const timeEntryApprovedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  timeEntryId: uuidSchema,
  costTransactionId: uuidSchema.nullable(),
});
export type TimeEntryApprovedV1 = z.infer<typeof timeEntryApprovedV1Schema>;

// M8 Field Operations (FR-FIELD-3). Fires once the underlying file has
// completed the Files pipeline's presigned-upload flow (file.uploaded.v1
// already covers "bytes are in object storage"; this covers "and it's
// attached as a photo, here's the field-specific metadata").
export const photoCapturedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  photoId: uuidSchema,
  entityType: z.string().nullable(),
  entityId: uuidSchema.nullable(),
});
export type PhotoCapturedV1 = z.infer<typeof photoCapturedV1Schema>;

// ai-spec.md §7.8 (Photo AI, FR-FIELD-7): fired after PhotoAiService
// writes photos.ai_tags — the RAG pipeline's reindex trigger for the
// "search-by-content" capability (photos indexed once they actually have
// tag/defect text worth searching). Carries aiRunId so the audit_log row
// this produces can link back to the metered model invocation that
// produced it (ai-spec §6: "every execution -> audit_log with
// ai_run_id") — the first real consumer of audit_log.ai_run_id, a column
// that's existed since the AI Gateway row with nothing populating it yet.
export const photoTaggedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  photoId: uuidSchema,
  aiRunId: uuidSchema,
});
export type PhotoTaggedV1 = z.infer<typeof photoTaggedV1Schema>;

// database.md §17: "mentions uuid[] (drives notifications)" — the
// Notifications module fans this out to one draft per mentioned user.
export const commentCreatedV1Schema = z.object({
  companyId: uuidSchema,
  entityType: z.string(),
  entityId: uuidSchema,
  commentId: uuidSchema,
  mentions: z.array(uuidSchema),
});
export type CommentCreatedV1 = z.infer<typeof commentCreatedV1Schema>;

// M7 Scheduling (FR-SCH-1/2). schedule.created.v1 fires once, the first
// time a project's master schedule is lazily get-or-created (api.md §6 has
// no dedicated "create schedule" endpoint — see schedules.ts's schema
// comment). schedule_activity.updated.v1 is the generic "header changed"
// event, same reasoning as project.updated.v1. schedule.recalculated.v1 is
// its own event (not folded into schedule_activity.updated.v1) since a CPM
// run can touch every activity in the schedule at once.
export const scheduleCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  scheduleId: uuidSchema,
});
export type ScheduleCreatedV1 = z.infer<typeof scheduleCreatedV1Schema>;

export const scheduleBaselineCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  scheduleId: uuidSchema,
  baselineOfId: uuidSchema,
});
export type ScheduleBaselineCreatedV1 = z.infer<typeof scheduleBaselineCreatedV1Schema>;

export const scheduleActivityCreatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  scheduleId: uuidSchema,
  activityId: uuidSchema,
});
export type ScheduleActivityCreatedV1 = z.infer<typeof scheduleActivityCreatedV1Schema>;

export const scheduleActivityUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  scheduleId: uuidSchema,
  activityId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type ScheduleActivityUpdatedV1 = z.infer<typeof scheduleActivityUpdatedV1Schema>;

export const scheduleActivityDeletedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  scheduleId: uuidSchema,
  activityId: uuidSchema,
});
export type ScheduleActivityDeletedV1 = z.infer<typeof scheduleActivityDeletedV1Schema>;

export const activityDependencyReplacedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  scheduleId: uuidSchema,
  activityId: uuidSchema,
  predecessorIds: z.array(uuidSchema),
});
export type ActivityDependencyReplacedV1 = z.infer<typeof activityDependencyReplacedV1Schema>;

export const scheduleRecalculatedV1Schema = z.object({
  companyId: uuidSchema,
  projectId: uuidSchema,
  scheduleId: uuidSchema,
  scheduleVersion: z.number().int(),
  activityCount: z.number().int(),
  criticalActivityCount: z.number().int(),
});
export type ScheduleRecalculatedV1 = z.infer<typeof scheduleRecalculatedV1Schema>;

// M7 Lookahead/resource conflicts (FR-SCH-5), roadmap.md "Lookahead/pull
// planning + resource conflicts" — same created/ended shape as
// equipment_assignment.*.v1.
export const resourceAssignmentCreatedV1Schema = z.object({
  companyId: uuidSchema,
  activityId: uuidSchema,
  resourceAssignmentId: uuidSchema,
  resourceType: z.enum(["crew", "equipment"]),
});
export type ResourceAssignmentCreatedV1 = z.infer<typeof resourceAssignmentCreatedV1Schema>;

export const resourceAssignmentDeletedV1Schema = z.object({
  companyId: uuidSchema,
  activityId: uuidSchema,
  resourceAssignmentId: uuidSchema,
});
export type ResourceAssignmentDeletedV1 = z.infer<typeof resourceAssignmentDeletedV1Schema>;

// M18 Platform/Admin (FR-PLAT-7). Only the actually-privileged actions get
// an event — requesting a full tenant-wide data export, and committing
// real writes from a guided import. The intermediate map/validate steps
// are dry runs (no data produced or written) and don't get one, same
// "audit privileged/financial actions" framing as every other mapper in
// audit-action-map.ts.
export const exportJobRequestedV1Schema = z.object({
  companyId: uuidSchema,
  exportJobId: uuidSchema,
  entityType: z.string(),
});
export type ExportJobRequestedV1 = z.infer<typeof exportJobRequestedV1Schema>;

export const importJobCommittedV1Schema = z.object({
  companyId: uuidSchema,
  importJobId: uuidSchema,
  entityType: z.string(),
  projectId: uuidSchema.nullable(),
  created: z.number().int(),
  skipped: z.number().int(),
});
export type ImportJobCommittedV1 = z.infer<typeof importJobCommittedV1Schema>;

// M16 Reports (FR-EXEC-2, api.md §14). Only the two privileged actions get
// an event — creating a saved definition and generating a run's artifact —
// same "audit privileged actions" framing as export_job.requested.v1.
export const reportDefinitionCreatedV1Schema = z.object({
  companyId: uuidSchema,
  reportDefinitionId: uuidSchema,
  kind: z.string(),
});
export type ReportDefinitionCreatedV1 = z.infer<typeof reportDefinitionCreatedV1Schema>;

export const reportDefinitionUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  reportDefinitionId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type ReportDefinitionUpdatedV1 = z.infer<typeof reportDefinitionUpdatedV1Schema>;

export const reportRunCompletedV1Schema = z.object({
  companyId: uuidSchema,
  reportDefinitionId: uuidSchema,
  reportRunId: uuidSchema,
});
export type ReportRunCompletedV1 = z.infer<typeof reportRunCompletedV1Schema>;

// FR-PLAT-8: accounting integration lifecycle — audited privileged actions
// (connect/disconnect a third-party financial system, complete a sync run
// that posts/reads real money data) same "audit-worthy" framing as
// report_run.completed.v1.
export const accountingConnectionConnectedV1Schema = z.object({
  companyId: uuidSchema,
  connectionId: uuidSchema,
  provider: z.string(),
  realmId: z.string(),
});
export type AccountingConnectionConnectedV1 = z.infer<typeof accountingConnectionConnectedV1Schema>;

export const accountingConnectionDisconnectedV1Schema = z.object({
  companyId: uuidSchema,
  connectionId: uuidSchema,
  provider: z.string(),
});
export type AccountingConnectionDisconnectedV1 = z.infer<typeof accountingConnectionDisconnectedV1Schema>;

export const accountingSyncRunCompletedV1Schema = z.object({
  companyId: uuidSchema,
  connectionId: uuidSchema,
  syncRunId: uuidSchema,
  provider: z.string(),
  pushedCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
});
export type AccountingSyncRunCompletedV1 = z.infer<typeof accountingSyncRunCompletedV1Schema>;

// api.md §16.3: outbound webhook endpoint CRUD is a privileged admin
// action (a registered endpoint receives every subscribed company event),
// same "audit-worthy" framing as admin.integration.manage mutations.
export const webhookEndpointCreatedV1Schema = z.object({
  companyId: uuidSchema,
  webhookEndpointId: uuidSchema,
  url: z.string(),
});
export type WebhookEndpointCreatedV1 = z.infer<typeof webhookEndpointCreatedV1Schema>;

export const webhookEndpointUpdatedV1Schema = z.object({
  companyId: uuidSchema,
  webhookEndpointId: uuidSchema,
  changedFields: z.array(z.string()),
});
export type WebhookEndpointUpdatedV1 = z.infer<typeof webhookEndpointUpdatedV1Schema>;

export const webhookEndpointDeletedV1Schema = z.object({
  companyId: uuidSchema,
  webhookEndpointId: uuidSchema,
});
export type WebhookEndpointDeletedV1 = z.infer<typeof webhookEndpointDeletedV1Schema>;

// api.md §16.3: "at-least-once, exponential retries 24 h -> dead-letter +
// notification." createdBy carries the endpoint owner so Notifications'
// event-notification-map (a single-recipient builder, same shape as
// user.invited.v1) can target them directly without a cross-module lookup.
export const webhookDeliveryDeadLetteredV1Schema = z.object({
  companyId: uuidSchema,
  webhookEndpointId: uuidSchema,
  eventType: z.string(),
  createdBy: uuidSchema.nullable(),
});
export type WebhookDeliveryDeadLetteredV1 = z.infer<typeof webhookDeliveryDeadLetteredV1Schema>;

// api.md §16.4 (NFR-23, roadmap "Public API GA"): server-to-server
// X-Api-Key auth, admin.apikey.manage-gated CRUD.
export const apiKeyCreatedV1Schema = z.object({
  companyId: uuidSchema,
  apiKeyId: uuidSchema,
  name: z.string(),
});
export type ApiKeyCreatedV1 = z.infer<typeof apiKeyCreatedV1Schema>;

export const apiKeyRevokedV1Schema = z.object({
  companyId: uuidSchema,
  apiKeyId: uuidSchema,
});
export type ApiKeyRevokedV1 = z.infer<typeof apiKeyRevokedV1Schema>;

// The event-type registry: maps each event_type string to its payload
// schema, so the relay/consumers can validate at both ends.
export const eventRegistry = {
  "company.registered.v1": companyRegisteredV1Schema,
  "company.updated.v1": companyUpdatedV1Schema,
  "user.preferences_updated.v1": userPreferencesUpdatedV1Schema,
  "user.invited.v1": userInvitedV1Schema,
  "role.assigned.v1": roleAssignedV1Schema,
  "role.created.v1": roleCreatedV1Schema,
  "permission.granted.v1": permissionGrantedV1Schema,
  "permission.revoked.v1": permissionRevokedV1Schema,
  "company_user.removed.v1": companyUserRemovedV1Schema,
  "user_role.revoked.v1": userRoleRevokedV1Schema,
  "permission_change_request.created.v1": permissionChangeRequestCreatedV1Schema,
  "permission_change_request.approved.v1": permissionChangeRequestApprovedV1Schema,
  "permission_change_request.rejected.v1": permissionChangeRequestRejectedV1Schema,
  "external_share.created.v1": externalShareCreatedV1Schema,
  "client_selection.created.v1": clientSelectionCreatedV1Schema,
  "client_selection.updated.v1": clientSelectionUpdatedV1Schema,
  "client_selection.decided.v1": clientSelectionDecidedV1Schema,
  "portal_message.created.v1": portalMessageCreatedV1Schema,
  "file.uploaded.v1": fileUploadedV1Schema,
  "file.scan_completed.v1": fileScanCompletedV1Schema,
  "project.created.v1": projectCreatedV1Schema,
  "project.updated.v1": projectUpdatedV1Schema,
  "project.deleted.v1": projectDeletedV1Schema,
  "project_member.added.v1": projectMemberAddedV1Schema,
  "project_member.removed.v1": projectMemberRemovedV1Schema,
  "cost_code.created.v1": costCodeCreatedV1Schema,
  "milestone.created.v1": milestoneCreatedV1Schema,
  "budget.created.v1": budgetCreatedV1Schema,
  "budget_line.created.v1": budgetLineCreatedV1Schema,
  "budget_line.updated.v1": budgetLineUpdatedV1Schema,
  "cost_transaction.posted.v1": costTransactionPostedV1Schema,
  "finance_alert.created.v1": financeAlertCreatedV1Schema,
  "contact_company.created.v1": contactCompanyCreatedV1Schema,
  "contact.created.v1": contactCreatedV1Schema,
  "pipeline_stage.created.v1": pipelineStageCreatedV1Schema,
  "opportunity.created.v1": opportunityCreatedV1Schema,
  "opportunity.updated.v1": opportunityUpdatedV1Schema,
  "opportunity.won.v1": opportunityWonV1Schema,
  "opportunity.lost.v1": opportunityLostV1Schema,
  "activity.created.v1": activityCreatedV1Schema,
  "supplier.created.v1": supplierCreatedV1Schema,
  "supplier.rated.v1": supplierRatedV1Schema,
  "purchase_order.created.v1": purchaseOrderCreatedV1Schema,
  "purchase_order.updated.v1": purchaseOrderUpdatedV1Schema,
  "purchase_order.approved.v1": purchaseOrderApprovedV1Schema,
  "purchase_order_line.created.v1": purchaseOrderLineCreatedV1Schema,
  "rfq.created.v1": rfqCreatedV1Schema,
  "supplier_quote.created.v1": supplierQuoteCreatedV1Schema,
  "delivery.created.v1": deliveryCreatedV1Schema,
  "inventory_item.created.v1": inventoryItemCreatedV1Schema,
  "inventory_location.created.v1": inventoryLocationCreatedV1Schema,
  "stock_movement.posted.v1": stockMovementPostedV1Schema,
  "equipment.created.v1": equipmentCreatedV1Schema,
  "equipment_assignment.created.v1": equipmentAssignmentCreatedV1Schema,
  "equipment_assignment.ended.v1": equipmentAssignmentEndedV1Schema,
  "equipment_usage_log.created.v1": equipmentUsageLogCreatedV1Schema,
  "maintenance_schedule.created.v1": maintenanceScheduleCreatedV1Schema,
  "maintenance_work_order.created.v1": maintenanceWorkOrderCreatedV1Schema,
  "maintenance_work_order.updated.v1": maintenanceWorkOrderUpdatedV1Schema,
  "equipment_inspection.created.v1": equipmentInspectionCreatedV1Schema,
  "safety_form_template.created.v1": safetyFormTemplateCreatedV1Schema,
  "safety_form.created.v1": safetyFormCreatedV1Schema,
  "incident.reported.v1": incidentReportedV1Schema,
  "incident.updated.v1": incidentUpdatedV1Schema,
  "certification.created.v1": certificationCreatedV1Schema,
  "certification.updated.v1": certificationUpdatedV1Schema,
  "subcontractor.created.v1": subcontractorCreatedV1Schema,
  "subcontractor.updated.v1": subcontractorUpdatedV1Schema,
  "subcontract.created.v1": subcontractCreatedV1Schema,
  "subcontract.approved.v1": subcontractApprovedV1Schema,
  "bid_package.created.v1": bidPackageCreatedV1Schema,
  "bid_invitation.created.v1": bidInvitationCreatedV1Schema,
  "bid.submitted.v1": bidSubmittedV1Schema,
  "invoice.created.v1": invoiceCreatedV1Schema,
  "invoice.approved.v1": invoiceApprovedV1Schema,
  "invoice.voided.v1": invoiceVoidedV1Schema,
  "invoice.paid.v1": invoicePaidV1Schema,
  "payment.created.v1": paymentCreatedV1Schema,
  "payment_application.created.v1": paymentApplicationCreatedV1Schema,
  "payment_application.approved.v1": paymentApplicationApprovedV1Schema,
  "payment_application.voided.v1": paymentApplicationVoidedV1Schema,
  "payment_application.pdf_generated.v1": paymentApplicationPdfGeneratedV1Schema,
  "estimate.created.v1": estimateCreatedV1Schema,
  "estimate.updated.v1": estimateUpdatedV1Schema,
  "estimate_line.created.v1": estimateLineCreatedV1Schema,
  "estimate_line.updated.v1": estimateLineUpdatedV1Schema,
  "estimate_line.deleted.v1": estimateLineDeletedV1Schema,
  "cost_item.created.v1": costItemCreatedV1Schema,
  "cost_item.price_observed.v1": costItemPriceObservedV1Schema,
  "assembly.created.v1": assemblyCreatedV1Schema,
  "change_order.created.v1": changeOrderCreatedV1Schema,
  "change_order.updated.v1": changeOrderUpdatedV1Schema,
  "change_order.approved.v1": changeOrderApprovedV1Schema,
  "change_order_line.created.v1": changeOrderLineCreatedV1Schema,
  "change_order_line.updated.v1": changeOrderLineUpdatedV1Schema,
  "change_order_line.deleted.v1": changeOrderLineDeletedV1Schema,
  "folder.created.v1": folderCreatedV1Schema,
  "document.created.v1": documentCreatedV1Schema,
  "document.updated.v1": documentUpdatedV1Schema,
  "document_version.created.v1": documentVersionCreatedV1Schema,
  "drawing_set.created.v1": drawingSetCreatedV1Schema,
  "drawing_set.published.v1": drawingSetPublishedV1Schema,
  "rfi.created.v1": rfiCreatedV1Schema,
  "rfi.updated.v1": rfiUpdatedV1Schema,
  "submittal.created.v1": submittalCreatedV1Schema,
  "submittal.updated.v1": submittalUpdatedV1Schema,
  "annotation.created.v1": annotationCreatedV1Schema,
  "task.created.v1": taskCreatedV1Schema,
  "task.updated.v1": taskUpdatedV1Schema,
  "task.deleted.v1": taskDeletedV1Schema,
  "daily_report.created.v1": dailyReportCreatedV1Schema,
  "daily_report.updated.v1": dailyReportUpdatedV1Schema,
  "daily_report.submitted.v1": dailyReportSubmittedV1Schema,
  "daily_report.ai_summary_generated.v1": dailyReportAiSummaryGeneratedV1Schema,
  "time_entry.created.v1": timeEntryCreatedV1Schema,
  "time_entry.approved.v1": timeEntryApprovedV1Schema,
  "photo.captured.v1": photoCapturedV1Schema,
  "photo.tagged.v1": photoTaggedV1Schema,
  "comment.created.v1": commentCreatedV1Schema,
  "schedule.created.v1": scheduleCreatedV1Schema,
  "schedule_baseline.created.v1": scheduleBaselineCreatedV1Schema,
  "schedule_activity.created.v1": scheduleActivityCreatedV1Schema,
  "schedule_activity.updated.v1": scheduleActivityUpdatedV1Schema,
  "schedule_activity.deleted.v1": scheduleActivityDeletedV1Schema,
  "activity_dependency.replaced.v1": activityDependencyReplacedV1Schema,
  "schedule.recalculated.v1": scheduleRecalculatedV1Schema,
  "resource_assignment.created.v1": resourceAssignmentCreatedV1Schema,
  "resource_assignment.deleted.v1": resourceAssignmentDeletedV1Schema,
  "export_job.requested.v1": exportJobRequestedV1Schema,
  "import_job.committed.v1": importJobCommittedV1Schema,
  "report_definition.created.v1": reportDefinitionCreatedV1Schema,
  "report_definition.updated.v1": reportDefinitionUpdatedV1Schema,
  "report_run.completed.v1": reportRunCompletedV1Schema,
  "accounting_connection.connected.v1": accountingConnectionConnectedV1Schema,
  "accounting_connection.disconnected.v1": accountingConnectionDisconnectedV1Schema,
  "accounting_sync_run.completed.v1": accountingSyncRunCompletedV1Schema,
  "webhook_endpoint.created.v1": webhookEndpointCreatedV1Schema,
  "webhook_endpoint.updated.v1": webhookEndpointUpdatedV1Schema,
  "webhook_endpoint.deleted.v1": webhookEndpointDeletedV1Schema,
  "webhook_delivery.dead_lettered.v1": webhookDeliveryDeadLetteredV1Schema,
  "api_key.created.v1": apiKeyCreatedV1Schema,
  "api_key.revoked.v1": apiKeyRevokedV1Schema,
} as const;

export type EventType = keyof typeof eventRegistry;

export const outboxEnvelopeSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  eventType: z.string(),
  payload: z.unknown(),
  dedupeKey: z.string(),
  occurredAt: z.string().datetime({ offset: true }),
  // Who did this (database.md §6, FR-RBAC-4) — null for genuinely
  // actor-less events; actorType still distinguishes "no actor" (system)
  // from "human actor" even when actorId itself is present.
  actorId: uuidSchema.nullable(),
  actorType: z.enum(["user", "system", "ai", "integration"]),
});
export type OutboxEnvelope = z.infer<typeof outboxEnvelopeSchema>;
