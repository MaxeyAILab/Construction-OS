import { Inject, Injectable } from "@nestjs/common";
import type { ScimListQuery, ScimPatchRequest, ScimUserResource } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { companyUsers, userRoles, users } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ScimUserNotFoundError } from "../domain/errors";

interface ScimUserRow {
  id: string;
  email: string;
  fullName: string;
}

function toScimUser(row: ScimUserRow, active: boolean) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: row.id,
    userName: row.email,
    name: { formatted: row.fullName },
    emails: [{ value: row.email, primary: true }],
    active,
    meta: { resourceType: "User" },
  };
}

// api.md §2.1 SCIM 2.0 (RFC 7643/7644) User endpoints. Deliberately
// permissive/subset-of-spec (see scimUserResourceSchema's doc comment) —
// the goal is "an IdP's directory sync works," not full protocol coverage.
// A SCIM-provisioned user is company_users.kind='internal' (a genuine
// employee), same as an SSO JIT-provisioned one (api.md §2.1) — 'external'
// is reserved for client/sub/supplier portal principals (database.md §17),
// an unrelated concept.
@Injectable()
export class ScimUsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, connectionId: string, query: ScimListQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(companyUsers)
        .innerJoin(users, eq(users.id, companyUsers.userId))
        .where(and(eq(companyUsers.tenantId, tenantId), isNull(companyUsers.deletedAt)));

      const filterValue = parseUserNameEqFilter(query.filter);
      const filtered = filterValue ? rows.filter((r) => r.email === filterValue) : rows;
      const startIndex = query.startIndex ?? 1;
      const count = query.count ?? 100;
      const page = filtered.slice(startIndex - 1, startIndex - 1 + count);

      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: filtered.length,
        startIndex,
        itemsPerPage: page.length,
        Resources: page.map((r) => toScimUser(r, true)),
      };
    });
  }

  async create(tenantId: string, connectionId: string, defaultRoleId: string, actorId: string | null, input: ScimUserResource) {
    const email = input.emails?.[0]?.value ?? input.userName;
    const fullName =
      input.name?.formatted ?? ([input.name?.givenName, input.name?.familyName].filter(Boolean).join(" ") || email);

    return withTenant(this.db, tenantId, async (tx) => {
      let user = await tx.query.users.findFirst({ where: eq(users.email, email) });
      if (!user) {
        [user] = await tx.insert(users).values({ email, fullName, passwordHash: null }).returning();
      }

      const existing = await tx.query.companyUsers.findFirst({
        where: and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, user!.id)),
      });
      if (!existing) {
        await tx.insert(companyUsers).values({ tenantId, userId: user!.id, createdBy: actorId });
        await tx.insert(userRoles).values({ tenantId, userId: user!.id, roleId: defaultRoleId, scopeType: "company" });
      } else if (existing.deletedAt) {
        await tx.update(companyUsers).set({ deletedAt: null, updatedBy: actorId }).where(eq(companyUsers.id, existing.id));
        await tx.insert(userRoles).values({ tenantId, userId: user!.id, roleId: defaultRoleId, scopeType: "company" }).onConflictDoNothing();
      }

      await this.outbox.append(tx, {
        tenantId,
        eventType: "scim_user.provisioned.v1",
        dedupeKey: `scim_user.provisioned.v1:${connectionId}:${user!.id}`,
        actorId: null,
        actorType: "integration",
        payload: { companyId: tenantId, ssoConnectionId: connectionId, userId: user!.id },
      });

      return toScimUser(user!, true);
    });
  }

  async get(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const row = await this.requireMember(tx, tenantId, id);
      return toScimUser(row.user, !row.membership.deletedAt);
    });
  }

  async patch(tenantId: string, connectionId: string, defaultRoleId: string, actorId: string | null, id: string, patch: ScimPatchRequest) {
    const activeOp = patch.Operations.find((op) => op.path === "active" || (op.path === undefined && typeof op.value === "object" && op.value !== null && "active" in (op.value as object)));
    let active: boolean | undefined;
    if (activeOp) {
      active = typeof activeOp.value === "boolean" ? activeOp.value : ((activeOp.value as { active?: boolean } | undefined)?.active);
    }
    if (active === false) return this.deactivate(tenantId, connectionId, actorId, id);
    if (active === true) return this.reactivate(tenantId, connectionId, defaultRoleId, actorId, id);
    return this.get(tenantId, id);
  }

  async replace(tenantId: string, actorId: string | null, id: string, input: ScimUserResource) {
    return withTenant(this.db, tenantId, async (tx) => {
      const row = await this.requireMember(tx, tenantId, id);
      const fullName = input.name?.formatted ?? row.user.fullName;
      const [updated] = await tx.update(users).set({ fullName }).where(eq(users.id, id)).returning();
      return toScimUser(updated!, !row.membership.deletedAt);
    });
  }

  // api.md §2.1: "hard deprovision... removes the company membership,
  // never deletes the global users row" — same soft-delete convention as
  // every other tenant-owned table (database.md §3), plus revoking role
  // assignments outright (RbacService.revokeRole's own pattern) since a
  // deprovisioned user shouldn't retain permission grants even though the
  // row itself is kept for audit/history.
  async delete(tenantId: string, connectionId: string, actorId: string | null, id: string) {
    await this.deactivate(tenantId, connectionId, actorId, id);
  }

  private async deactivate(tenantId: string, connectionId: string, actorId: string | null, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const row = await this.requireMember(tx, tenantId, id);
      await tx.update(companyUsers).set({ deletedAt: new Date(), updatedBy: actorId }).where(eq(companyUsers.id, row.membership.id));
      await tx.delete(userRoles).where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, id)));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "scim_user.deprovisioned.v1",
        dedupeKey: `scim_user.deprovisioned.v1:${connectionId}:${id}:${Date.now()}`,
        actorId: null,
        actorType: "integration",
        payload: { companyId: tenantId, ssoConnectionId: connectionId, userId: id },
      });

      return toScimUser(row.user, false);
    });
  }

  private async reactivate(tenantId: string, connectionId: string, defaultRoleId: string, actorId: string | null, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const membership = await tx.query.companyUsers.findFirst({
        where: and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, id)),
      });
      if (!membership) throw new ScimUserNotFoundError();
      await tx.update(companyUsers).set({ deletedAt: null, updatedBy: actorId }).where(eq(companyUsers.id, membership.id));
      await tx.insert(userRoles).values({ tenantId, userId: id, roleId: defaultRoleId, scopeType: "company" }).onConflictDoNothing();

      const user = await tx.query.users.findFirst({ where: eq(users.id, id) });
      return toScimUser(user!, true);
    });
  }

  private async requireMember(tx: Database, tenantId: string, id: string) {
    const membership = await tx.query.companyUsers.findFirst({
      where: and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, id), isNull(companyUsers.deletedAt)),
    });
    if (!membership) throw new ScimUserNotFoundError();
    const user = await tx.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw new ScimUserNotFoundError();
    return { membership, user };
  }
}

// RFC 7644 §3.4.2.2: `filter=userName eq "value"` — the one filter shape
// IdPs actually send during directory sync (dedupe-by-username lookup).
function parseUserNameEqFilter(filter: string | undefined): string | null {
  if (!filter) return null;
  const match = /^userName eq "(.+)"$/.exec(filter.trim());
  return match ? match[1]! : null;
}
