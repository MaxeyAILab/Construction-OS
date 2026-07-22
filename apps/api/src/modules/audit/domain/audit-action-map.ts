import type { EventType } from "@constructionos/schemas";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
}

type AuditMapper = (payload: Record<string, unknown>) => AuditEntry;

// database.md §6: action strings reuse the exact platform.* permission key
// that gates the corresponding mutation (api.md §1.1's module.resource.action
// convention) — e.g. role.created.v1 -> "platform.role.manage" because
// RbacController.createRole is @RequirePermission('platform.role.manage').
// That keeps "what permission let this happen" and "what got logged"
// traceable to the same string instead of a parallel vocabulary.
const mappers: Partial<Record<EventType, AuditMapper>> = {
  "company.registered.v1": (payload) => ({
    action: "platform.company.register",
    entityType: "company",
    entityId: payload.companyId as string,
  }),
  "user.invited.v1": (payload) => ({
    action: "platform.company_user.invite",
    entityType: "user",
    entityId: payload.userId as string,
  }),
  "role.assigned.v1": (payload) => ({
    action: "platform.user_role.assign",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  "role.created.v1": (payload) => ({
    action: "platform.role.manage",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  "permission.granted.v1": (payload) => ({
    action: "platform.role.manage",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  "permission.revoked.v1": (payload) => ({
    action: "platform.role.manage",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  "company_user.removed.v1": (payload) => ({
    action: "platform.company_user.remove",
    entityType: "user",
    entityId: payload.userId as string,
  }),
  "user_role.revoked.v1": (payload) => ({
    action: "platform.user_role.revoke",
    entityType: "role",
    entityId: payload.roleId as string,
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
};

export function mapToAuditEntry(eventType: string, payload: unknown): AuditEntry | null {
  const mapper = mappers[eventType as EventType];
  if (!mapper) return null;
  return mapper(payload as Record<string, unknown>);
}
