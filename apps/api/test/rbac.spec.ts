import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyUsers } from "../src/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import { withTenant } from "../src/infrastructure/db/client";
import { DuplicateRoleNameError, UnknownPermissionError } from "../src/modules/rbac/domain/errors";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestAuthService } from "./setup/auth";
import { buildTestRbacServices } from "./setup/rbac";

describe("RBAC", () => {
  const db = getTestDatabase();
  const { authService } = buildTestAuthService(db);
  const { rbacService, permissionResolver, redis } = buildTestRbacServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("grants the auto-created Owner role every catalog permission", async () => {
    const suffix = Date.now();
    const signUp = await authService.signUp({
      email: `rbac-owner-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `RBAC Co ${suffix}`,
    });

    const granted = await permissionResolver.resolve(
      signUp.companyId,
      signUp.accessToken ? decodeSub(signUp.accessToken) : "",
    );
    expect(granted).toContain("platform.role.manage");
    expect(granted).toContain("platform.company_user.invite");
  });

  it("a freshly created role starts with no permissions", async () => {
    const suffix = Date.now();
    const signUp = await authService.signUp({
      email: `rbac-fresh-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Fresh Co ${suffix}`,
    });

    const role = await rbacService.createRole(signUp.companyId, "Viewer");
    const roles = await rbacService.listRoles(signUp.companyId);
    const viewer = roles.find((r) => r.id === role.id);
    expect(viewer?.permissions).toEqual([]);
  });

  it("rejects creating a duplicate role name in the same tenant", async () => {
    const suffix = Date.now();
    const signUp = await authService.signUp({
      email: `rbac-dup-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Dup Co ${suffix}`,
    });

    await rbacService.createRole(signUp.companyId, "Estimator");
    await expect(rbacService.createRole(signUp.companyId, "Estimator")).rejects.toThrow(
      DuplicateRoleNameError,
    );
  });

  it("rejects granting an unknown permission key", async () => {
    const suffix = Date.now();
    const signUp = await authService.signUp({
      email: `rbac-unknown-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Unknown Co ${suffix}`,
    });
    const role = await rbacService.createRole(signUp.companyId, "Viewer");

    await expect(
      rbacService.grantPermissionToRole(signUp.companyId, role.id, "not.a.real.permission"),
    ).rejects.toThrow(UnknownPermissionError);
  });

  it("invited users have no permissions until a role is assigned, then reflect the grant", async () => {
    const suffix = Date.now();
    const signUp = await authService.signUp({
      email: `rbac-invite-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Invite Co ${suffix}`,
    });

    const role = await rbacService.createRole(signUp.companyId, "Field Crew");
    await rbacService.grantPermissionToRole(signUp.companyId, role.id, "platform.role.read");

    const invited = await rbacService.inviteUser(
      signUp.companyId,
      `invitee-${suffix}@example.com`,
      "Invitee Person",
    );

    expect(await permissionResolver.resolve(signUp.companyId, invited.userId)).toEqual([]);

    await rbacService.assignRole(signUp.companyId, invited.userId, role.id, {
      scopeType: "company",
    });
    expect(await permissionResolver.resolve(signUp.companyId, invited.userId)).toContain(
      "platform.role.read",
    );

    await rbacService.revokeRole(signUp.companyId, invited.userId, role.id);
    expect(await permissionResolver.resolve(signUp.companyId, invited.userId)).toEqual([]);
  });

  it("removeUser drops company membership", async () => {
    const suffix = Date.now();
    const signUp = await authService.signUp({
      email: `rbac-remove-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Remove Co ${suffix}`,
    });
    const invited = await rbacService.inviteUser(
      signUp.companyId,
      `removeme-${suffix}@example.com`,
      "Remove Me",
    );

    await rbacService.removeUser(signUp.companyId, invited.userId);

    const membership = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.companyUsers.findFirst({
        where: and(
          eq(companyUsers.tenantId, signUp.companyId),
          eq(companyUsers.userId, invited.userId),
        ),
      }),
    );
    expect(membership).toBeUndefined();
  });
});

function decodeSub(jwt: string): string {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
  return payload.sub;
}
