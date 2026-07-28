import { Inject, Injectable } from "@nestjs/common";
import type { ListPermissionChangeRequestsQuery } from "@constructionos/schemas";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { permissionChangeRequests } from "../../../infrastructure/db/schema";
import { assertMakerChecker } from "../../../platform/maker-checker";
// Deep import, not the "../../auth" barrel — see rbac.module.ts's doc
// comment on the same import for why (auth's own CompanySettingsController
// imports from this module's index.ts, so the barrel would cycle).
import { CompanySettingsService } from "../../auth/application/company-settings.service";
import { OutboxService } from "../../events";
import {
  PermissionChangeRequestNotFoundError,
  PermissionChangeRequestNotPendingError,
  PermissionDeniedError,
} from "../domain/errors";
import { PermissionResolverService } from "./permission-resolver.service";
import { RbacService } from "./rbac.service";

export type PermissionChangeActionType = "assign_role" | "revoke_role" | "grant_permission" | "revoke_permission";

export interface AssignRolePayload {
  userId: string;
  roleId: string;
  scopeType: "company" | "project";
  projectId?: string | undefined;
}
export interface RevokeRolePayload {
  userId: string;
  roleId: string;
}
export interface GrantOrRevokePermissionPayload {
  roleId: string;
  permissionKey: string;
}

type RequestPayload = AssignRolePayload | RevokeRolePayload | GrantOrRevokePermissionPayload;

// api.md §1.1's module.resource.action convention — approving/rejecting a
// queued request (when it's not a self-cancel) requires the SAME
// permission the underlying action itself would have required, per
// architecture.md §12 ("not new permission types").
const REQUIRED_PERMISSION_BY_ACTION_TYPE: Record<PermissionChangeActionType, string> = {
  assign_role: "platform.user_role.assign",
  revoke_role: "platform.user_role.revoke",
  grant_permission: "platform.role.manage",
  revoke_permission: "platform.role.manage",
};

// spec.md §10.2 (Segregation of duties): "permission changes support
// maker/checker workflows for enterprise tenants." RbacController routes
// assign/revoke-role and grant/revoke-permission through `request()` here
// instead of calling RbacService directly whenever a tenant's
// companies.settings.enforceMakerChecker is on; `approve()` is the only
// path that actually performs the mutation, by calling back into
// RbacService's existing (unmodified) apply methods — this service depends
// on RbacService, never the reverse, so there's no DI cycle and every
// existing direct-call test/behavior of RbacService is untouched.
@Injectable()
export class PermissionChangeRequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly companySettings: CompanySettingsService,
    private readonly permissions: PermissionResolverService,
    private readonly rbac: RbacService,
  ) {}

  async isEnabled(tenantId: string): Promise<boolean> {
    return this.companySettings.isMakerCheckerEnabled(tenantId);
  }

  async list(tenantId: string, query: ListPermissionChangeRequestsQuery) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.permissionChangeRequests.findMany({
        where: and(
          eq(permissionChangeRequests.tenantId, tenantId),
          ...(query.status ? [eq(permissionChangeRequests.status, query.status)] : []),
        ),
        orderBy: [desc(permissionChangeRequests.createdAt)],
      }),
    );
  }

  async request(tenantId: string, actorId: string, actionType: PermissionChangeActionType, payload: RequestPayload) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(permissionChangeRequests)
        .values({ tenantId, actionType, payload, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "permission_change_request.created.v1",
        dedupeKey: `permission_change_request.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, requestId: created!.id, actionType, requestedBy: actorId },
      });

      return created!;
    });
  }

  async approve(tenantId: string, actorId: string, requestId: string) {
    const request = await this.requirePending(tenantId, requestId);
    assertMakerChecker(true, actorId, request.createdBy);

    const requiredPermission = REQUIRED_PERMISSION_BY_ACTION_TYPE[request.actionType as PermissionChangeActionType];
    if (!(await this.permissions.has(tenantId, actorId, requiredPermission))) {
      throw new PermissionDeniedError(requiredPermission);
    }

    await this.applyAction(tenantId, actorId, request.actionType as PermissionChangeActionType, request.payload as RequestPayload);

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(permissionChangeRequests)
        .set({ status: "approved", decidedBy: actorId, decidedAt: new Date(), updatedBy: actorId })
        .where(eq(permissionChangeRequests.id, requestId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "permission_change_request.approved.v1",
        dedupeKey: `permission_change_request.approved.v1:${requestId}`,
        actorId,
        payload: {
          companyId: tenantId,
          requestId,
          actionType: request.actionType,
          requestedBy: request.createdBy,
        },
      });

      return updated!;
    });
  }

  // Self-cancel (the requester withdraws their own request) never needs
  // the maker-checker split since nothing was ever applied; a different
  // actor rejecting someone else's request still needs the same
  // permission the action itself would require.
  async reject(tenantId: string, actorId: string, requestId: string) {
    const request = await this.requirePending(tenantId, requestId);

    if (actorId !== request.createdBy) {
      const requiredPermission = REQUIRED_PERMISSION_BY_ACTION_TYPE[request.actionType as PermissionChangeActionType];
      if (!(await this.permissions.has(tenantId, actorId, requiredPermission))) {
        throw new PermissionDeniedError(requiredPermission);
      }
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(permissionChangeRequests)
        .set({ status: "rejected", decidedBy: actorId, decidedAt: new Date(), updatedBy: actorId })
        .where(eq(permissionChangeRequests.id, requestId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "permission_change_request.rejected.v1",
        dedupeKey: `permission_change_request.rejected.v1:${requestId}`,
        actorId,
        payload: {
          companyId: tenantId,
          requestId,
          actionType: request.actionType,
          requestedBy: request.createdBy,
        },
      });

      return updated!;
    });
  }

  private async applyAction(
    tenantId: string,
    actorId: string,
    actionType: PermissionChangeActionType,
    payload: RequestPayload,
  ): Promise<void> {
    switch (actionType) {
      case "assign_role": {
        const p = payload as AssignRolePayload;
        await this.rbac.assignRole(tenantId, p.userId, p.roleId, { scopeType: p.scopeType, projectId: p.projectId }, actorId);
        return;
      }
      case "revoke_role": {
        const p = payload as RevokeRolePayload;
        await this.rbac.revokeRole(tenantId, p.userId, p.roleId, actorId);
        return;
      }
      case "grant_permission": {
        const p = payload as GrantOrRevokePermissionPayload;
        await this.rbac.grantPermissionToRole(tenantId, p.roleId, p.permissionKey, actorId);
        return;
      }
      case "revoke_permission": {
        const p = payload as GrantOrRevokePermissionPayload;
        await this.rbac.revokePermissionFromRole(tenantId, p.roleId, p.permissionKey, actorId);
        return;
      }
    }
  }

  private async requirePending(tenantId: string, requestId: string) {
    const request = await withTenant(this.db, tenantId, (tx) =>
      tx.query.permissionChangeRequests.findFirst({
        where: and(eq(permissionChangeRequests.tenantId, tenantId), eq(permissionChangeRequests.id, requestId)),
      }),
    );
    if (!request) throw new PermissionChangeRequestNotFoundError();
    if (request.status !== "pending") throw new PermissionChangeRequestNotPendingError();
    return request;
  }
}
