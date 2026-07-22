import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  companyUsers,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "../../../infrastructure/db/schema";
// Real (non-type-only) import required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime, not just its type.
import { OutboxService } from "../../events";
import {
  AlreadyAMemberError,
  DuplicateRoleNameError,
  RoleNotFoundError,
  UnknownPermissionError,
  UserNotFoundError,
} from "../domain/errors";
import { PermissionCacheService } from "../infrastructure/permission-cache.service";

@Injectable()
export class RbacService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cache: PermissionCacheService,
    private readonly outbox: OutboxService,
  ) {}

  async listRoles(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const roleRows = await tx.query.roles.findMany({ where: eq(roles.tenantId, tenantId) });
      const grants = await tx
        .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(eq(rolePermissions.tenantId, tenantId));

      return roleRows.map((role) => ({
        ...role,
        permissions: grants.filter((g) => g.roleId === role.id).map((g) => g.key),
      }));
    });
  }

  async listPermissionCatalog() {
    return this.db.select().from(permissions);
  }

  async createRole(tenantId: string, name: string, actorId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.roles.findFirst({
        where: and(eq(roles.tenantId, tenantId), eq(roles.name, name)),
      });
      if (existing) throw new DuplicateRoleNameError();

      const [role] = await tx.insert(roles).values({ tenantId, name }).returning();
      await this.outbox.append(tx, {
        tenantId,
        eventType: "role.created.v1",
        payload: { companyId: tenantId, roleId: role!.id, roleName: role!.name },
        dedupeKey: randomUUID(),
        actorId,
      });
      return role!;
    });
  }

  async grantPermissionToRole(
    tenantId: string,
    roleId: string,
    permissionKey: string,
    actorId: string,
  ): Promise<void> {
    const permission = await this.db.query.permissions.findFirst({
      where: eq(permissions.key, permissionKey),
    });
    if (!permission) throw new UnknownPermissionError(permissionKey);

    await withTenant(this.db, tenantId, async (tx) => {
      const role = await tx.query.roles.findFirst({
        where: and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)),
      });
      if (!role) throw new RoleNotFoundError();

      // .onConflictDoNothing().returning() is empty when the grant already
      // existed — skip the event in that case so re-granting an existing
      // permission doesn't produce a spurious audit entry.
      const inserted = await tx
        .insert(rolePermissions)
        .values({ tenantId, roleId, permissionKey })
        .onConflictDoNothing()
        .returning();
      if (inserted.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "permission.granted.v1",
          payload: { companyId: tenantId, roleId, permissionKey },
          dedupeKey: randomUUID(),
          actorId,
        });
      }
    });

    await this.cache.invalidateTenant(tenantId);
  }

  async revokePermissionFromRole(
    tenantId: string,
    roleId: string,
    permissionKey: string,
    actorId: string,
  ): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const deleted = await tx
        .delete(rolePermissions)
        .where(
          and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionKey, permissionKey)),
        )
        .returning();
      if (deleted.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "permission.revoked.v1",
          payload: { companyId: tenantId, roleId, permissionKey },
          dedupeKey: randomUUID(),
          actorId,
        });
      }
    });
    await this.cache.invalidateTenant(tenantId);
  }

  async inviteUser(
    tenantId: string,
    email: string,
    fullName: string,
    actorId: string,
  ): Promise<{ userId: string }> {
    let user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      const [created] = await this.db
        .insert(users)
        .values({ email, fullName, status: "invited" })
        .returning();
      user = created!;
    }

    await withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.companyUsers.findFirst({
        where: and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, user!.id)),
      });
      if (existing) throw new AlreadyAMemberError();

      await tx.insert(companyUsers).values({ tenantId, userId: user!.id });
      await this.outbox.append(tx, {
        tenantId,
        eventType: "user.invited.v1",
        payload: { companyId: tenantId, userId: user!.id, email: user!.email },
        dedupeKey: randomUUID(),
        actorId,
      });
    });

    return { userId: user.id };
  }

  async removeUser(tenantId: string, userId: string, actorId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, userId)));
      const removed = await tx
        .delete(companyUsers)
        .where(and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, userId)))
        .returning();
      if (removed.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "company_user.removed.v1",
          payload: { companyId: tenantId, userId },
          dedupeKey: randomUUID(),
          actorId,
        });
      }
    });
    await this.cache.invalidateUser(tenantId, userId);
  }

  async assignRole(
    tenantId: string,
    userId: string,
    roleId: string,
    scope: { scopeType: "company" | "project"; projectId?: string | undefined },
    actorId: string,
  ): Promise<void> {
    const targetUser = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!targetUser) throw new UserNotFoundError();

    await withTenant(this.db, tenantId, async (tx) => {
      const role = await tx.query.roles.findFirst({
        where: and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)),
      });
      if (!role) throw new RoleNotFoundError();

      await tx.insert(userRoles).values({
        tenantId,
        userId,
        roleId,
        scopeType: scope.scopeType,
        projectId: scope.projectId,
      });
      await this.outbox.append(tx, {
        tenantId,
        eventType: "role.assigned.v1",
        payload: {
          companyId: tenantId,
          userId,
          roleId,
          scopeType: scope.scopeType,
          projectId: scope.projectId,
        },
        dedupeKey: randomUUID(),
        actorId,
      });
    });

    await this.cache.invalidateUser(tenantId, userId);
  }

  async revokeRole(
    tenantId: string,
    userId: string,
    roleId: string,
    actorId: string,
  ): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const revoked = await tx
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.tenantId, tenantId),
            eq(userRoles.userId, userId),
            eq(userRoles.roleId, roleId),
          ),
        )
        .returning();
      if (revoked.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "user_role.revoked.v1",
          payload: { companyId: tenantId, userId, roleId },
          dedupeKey: randomUUID(),
          actorId,
        });
      }
    });
    await this.cache.invalidateUser(tenantId, userId);
  }
}
