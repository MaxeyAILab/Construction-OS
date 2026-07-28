import { Inject, Injectable } from "@nestjs/common";
import type { ScimPatchRequest } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { roles, userRoles, users } from "../../../infrastructure/db/schema";
// Deep import, not the "../../rbac" barrel — same cycle-avoidance
// precedent as rbac.module.ts's own doc comment on importing
// CompanySettingsService from auth: rbac's barrel re-exports
// RbacModule/PermissionGuard, pulling in far more than this file needs.
import { RbacService } from "../../rbac/application/rbac.service";
import { ScimGroupNotFoundError } from "../domain/errors";

function toScimGroup(role: { id: string; name: string }, members: { id: string; fullName: string }[]) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: role.id,
    displayName: role.name,
    members: members.map((m) => ({ value: m.id, display: m.fullName })),
    meta: { resourceType: "Group" },
  };
}

// api.md §2.1: "one SCIM Group per tenant role... ConstructionOS remains
// the source of truth for permissions" — Groups are read-only *identity*
// (you can't create/rename a role through SCIM, only /admin/roles), but
// PATCH .../members syncs role *assignment* by delegating to RbacService's
// existing assign/revoke methods, same "not a parallel authorization
// system" precedent as everywhere else RBAC is touched from outside its
// own module.
@Injectable()
export class ScimGroupsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly rbac: RbacService,
  ) {}

  async list(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const roleRows = await tx.query.roles.findMany({ where: eq(roles.tenantId, tenantId) });
      const resources = await Promise.all(roleRows.map((role) => this.buildGroup(tx, tenantId, role)));
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: resources.length,
        Resources: resources,
      };
    });
  }

  async get(tenantId: string, roleId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const role = await tx.query.roles.findFirst({ where: and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)) });
      if (!role) throw new ScimGroupNotFoundError();
      return this.buildGroup(tx, tenantId, role);
    });
  }

  // No human actorId exists for a SCIM-driven sync — RbacService accepts
  // null (attributed as actorType='integration' on the resulting outbox
  // events) rather than this method duplicating the assign/revoke+event
  // logic itself.
  async patchMembers(tenantId: string, connectionId: string, roleId: string, patch: ScimPatchRequest) {
    const role = await withTenant(this.db, tenantId, (tx) =>
      tx.query.roles.findFirst({ where: and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)) }),
    );
    if (!role) throw new ScimGroupNotFoundError();

    const replaceOp = patch.Operations.find((op) => op.op === "replace" && (op.path === "members" || op.path === undefined));
    if (replaceOp) {
      const desired = new Set(
        (Array.isArray(replaceOp.value) ? replaceOp.value : []).map((m) => (m as { value: string }).value),
      );
      const current = await withTenant(this.db, tenantId, (tx) =>
        tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.roleId, roleId), eq(userRoles.scopeType, "company"))),
      );
      const currentIds = new Set(current.map((c) => c.userId));

      for (const userId of desired) {
        if (!currentIds.has(userId)) {
          await this.rbac.assignRole(tenantId, userId, roleId, { scopeType: "company" }, null);
        }
      }
      for (const userId of currentIds) {
        if (!desired.has(userId)) {
          await this.rbac.revokeRole(tenantId, userId, roleId, null);
        }
      }
    }

    return this.get(tenantId, roleId);
  }

  private async buildGroup(tx: Database, tenantId: string, role: { id: string; name: string }) {
    const members = await tx
      .select({ id: users.id, fullName: users.fullName })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.roleId, role.id), eq(userRoles.scopeType, "company")));
    return toScimGroup(role, members);
  }
}
