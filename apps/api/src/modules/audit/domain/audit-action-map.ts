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
};

export function mapToAuditEntry(eventType: string, payload: unknown): AuditEntry | null {
  const mapper = mappers[eventType as EventType];
  if (!mapper) return null;
  return mapper(payload as Record<string, unknown>);
}
