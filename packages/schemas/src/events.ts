import { z } from "zod";
import { uuidSchema } from "./common";

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

// The event-type registry: maps each event_type string to its payload
// schema, so the relay/consumers can validate at both ends.
export const eventRegistry = {
  "company.registered.v1": companyRegisteredV1Schema,
  "user.invited.v1": userInvitedV1Schema,
  "role.assigned.v1": roleAssignedV1Schema,
  "role.created.v1": roleCreatedV1Schema,
  "permission.granted.v1": permissionGrantedV1Schema,
  "permission.revoked.v1": permissionRevokedV1Schema,
  "company_user.removed.v1": companyUserRemovedV1Schema,
  "user_role.revoked.v1": userRoleRevokedV1Schema,
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
