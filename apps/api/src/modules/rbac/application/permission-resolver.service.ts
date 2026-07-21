import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { rolePermissions, roles, userRoles } from "../../../infrastructure/db/schema";
import { PermissionCacheService } from "../infrastructure/permission-cache.service";

@Injectable()
export class PermissionResolverService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cache: PermissionCacheService,
  ) {}

  async resolve(tenantId: string, userId: string): Promise<string[]> {
    const cached = await this.cache.get(tenantId, userId);
    if (cached) return cached;

    const permissions = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ key: rolePermissions.permissionKey })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, userId))),
    );

    const keys = [...new Set(permissions.map((p) => p.key))];
    await this.cache.set(tenantId, userId, keys);
    return keys;
  }

  async has(tenantId: string, userId: string, permission: string): Promise<boolean> {
    const granted = await this.resolve(tenantId, userId);
    return granted.includes(permission);
  }
}
