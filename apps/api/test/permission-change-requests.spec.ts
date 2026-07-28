import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestAuthService } from "./setup/auth";
import { buildTestRbacServices } from "./setup/rbac";

// spec.md §10.2 (Segregation of duties): "permission changes support
// maker/checker workflows for enterprise tenants" — the third item
// alongside the change-order/financial-approval maker-checker work
// (change-orders.spec.ts, finance.spec.ts, payment-applications.spec.ts).
// Unlike those, permission changes have no existing single-step approve()
// action, so this is a real request -> approve/reject queue
// (permission_change_requests) rather than a policy check bolted onto an
// existing method.
describe("Permission change requests (segregation of duties for RBAC mutations)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { rbacService, permissionResolver, permissionChangeRequestsService, companySettingsService, redis: rbacRedis } =
    buildTestRbacServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await rbacRedis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `pcr-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `PCR ${label} ${suffix}`,
    });
    const payload = JSON.parse(Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString());
    return { tenantId: signUp.companyId, ownerId: payload.sub as string };
  }

  it("queues a grant_permission request and blocks the requester from approving their own request", async () => {
    const { tenantId, ownerId } = await signUpCompany("self-approve");
    await companySettingsService.update(tenantId, ownerId, { settings: { enforceMakerChecker: true } });

    const role = await rbacService.createRole(tenantId, "Viewer", ownerId);
    const request = await permissionChangeRequestsService.request(tenantId, ownerId, "grant_permission", {
      roleId: role.id,
      permissionKey: "admin.role.read",
    });
    expect(request.status).toBe("pending");

    await expect(permissionChangeRequestsService.approve(tenantId, ownerId, request.id)).rejects.toMatchObject({
      code: "maker_checker_violation",
      status: 409,
    });

    // Rejected self-approval attempt must not have applied the grant.
    const roles = await rbacService.listRoles(tenantId);
    expect(roles.find((r) => r.id === role.id)?.permissions).toEqual([]);
  });

  it("a different admin with the required permission can approve, applying the grant", async () => {
    const { tenantId, ownerId } = await signUpCompany("approve");
    await companySettingsService.update(tenantId, ownerId, { settings: { enforceMakerChecker: true } });

    const role = await rbacService.createRole(tenantId, "Viewer", ownerId);
    const request = await permissionChangeRequestsService.request(tenantId, ownerId, "grant_permission", {
      roleId: role.id,
      permissionKey: "admin.role.read",
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: checkerId } = await rbacService.inviteUser(tenantId, `checker-${suffix}@example.com`, "Checker", ownerId, "internal");
    const checkerRole = await rbacService.createRole(tenantId, "Admin", ownerId);
    await rbacService.grantPermissionToRole(tenantId, checkerRole.id, "admin.role.manage", ownerId);
    await rbacService.assignRole(tenantId, checkerId, checkerRole.id, { scopeType: "company" }, ownerId);

    const approved = await permissionChangeRequestsService.approve(tenantId, checkerId, request.id);
    expect(approved.status).toBe("approved");

    const roles = await rbacService.listRoles(tenantId);
    expect(roles.find((r) => r.id === role.id)?.permissions).toContain("admin.role.read");
  });

  it("rejects approval from an admin lacking the underlying action's permission", async () => {
    const { tenantId, ownerId } = await signUpCompany("underprivileged");
    await companySettingsService.update(tenantId, ownerId, { settings: { enforceMakerChecker: true } });

    const role = await rbacService.createRole(tenantId, "Viewer", ownerId);
    const request = await permissionChangeRequestsService.request(tenantId, ownerId, "grant_permission", {
      roleId: role.id,
      permissionKey: "admin.role.read",
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: bystanderId } = await rbacService.inviteUser(tenantId, `bystander-${suffix}@example.com`, "Bystander", ownerId, "internal");

    await expect(permissionChangeRequestsService.approve(tenantId, bystanderId, request.id)).rejects.toMatchObject({
      code: "permission_denied",
      status: 403,
    });
  });

  it("a requester can self-cancel (reject) their own pending request without any permission check", async () => {
    const { tenantId, ownerId } = await signUpCompany("self-cancel");
    await companySettingsService.update(tenantId, ownerId, { settings: { enforceMakerChecker: true } });

    const role = await rbacService.createRole(tenantId, "Viewer", ownerId);
    const request = await permissionChangeRequestsService.request(tenantId, ownerId, "grant_permission", {
      roleId: role.id,
      permissionKey: "admin.role.read",
    });

    const rejected = await permissionChangeRequestsService.reject(tenantId, ownerId, request.id);
    expect(rejected.status).toBe("rejected");

    // A decided request can't be approved afterward.
    await expect(permissionChangeRequestsService.approve(tenantId, ownerId, request.id)).rejects.toMatchObject({
      code: "illegal_transition",
      status: 409,
    });
  });

  it("assign_role and revoke_role requests apply the same effect a direct RbacService call would", async () => {
    const { tenantId, ownerId } = await signUpCompany("assign-revoke");
    await companySettingsService.update(tenantId, ownerId, { settings: { enforceMakerChecker: true } });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: targetUserId } = await rbacService.inviteUser(tenantId, `target-${suffix}@example.com`, "Target", ownerId, "internal");
    const role = await rbacService.createRole(tenantId, "Field", ownerId);

    const assignRequest = await permissionChangeRequestsService.request(tenantId, ownerId, "assign_role", {
      userId: targetUserId,
      roleId: role.id,
      scopeType: "company",
      projectId: undefined,
    });

    const suffix2 = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: checkerId } = await rbacService.inviteUser(tenantId, `checker2-${suffix2}@example.com`, "Checker2", ownerId, "internal");
    const checkerRole = await rbacService.createRole(tenantId, "Admin", ownerId);
    await rbacService.grantPermissionToRole(tenantId, checkerRole.id, "admin.user_role.assign", ownerId);
    await rbacService.grantPermissionToRole(tenantId, checkerRole.id, "admin.user_role.revoke", ownerId);
    await rbacService.assignRole(tenantId, checkerId, checkerRole.id, { scopeType: "company" }, ownerId);

    await permissionChangeRequestsService.approve(tenantId, checkerId, assignRequest.id);
    let granted = await permissionResolver.resolve(tenantId, targetUserId);
    expect(granted).not.toContain("admin.role.read");

    await rbacService.grantPermissionToRole(tenantId, role.id, "admin.role.read", ownerId);
    granted = await permissionResolver.resolve(tenantId, targetUserId);
    expect(granted).toContain("admin.role.read");

    const revokeRequest = await permissionChangeRequestsService.request(tenantId, ownerId, "revoke_role", {
      userId: targetUserId,
      roleId: role.id,
    });
    await permissionChangeRequestsService.approve(tenantId, checkerId, revokeRequest.id);
    granted = await permissionResolver.resolve(tenantId, targetUserId);
    expect(granted).not.toContain("admin.role.read");
  });

  it("list() filters by status", async () => {
    const { tenantId, ownerId } = await signUpCompany("list");
    await companySettingsService.update(tenantId, ownerId, { settings: { enforceMakerChecker: true } });

    const role = await rbacService.createRole(tenantId, "Viewer", ownerId);
    const pending = await permissionChangeRequestsService.request(tenantId, ownerId, "grant_permission", {
      roleId: role.id,
      permissionKey: "admin.role.read",
    });
    const toReject = await permissionChangeRequestsService.request(tenantId, ownerId, "grant_permission", {
      roleId: role.id,
      permissionKey: "admin.company_user.invite",
    });
    await permissionChangeRequestsService.reject(tenantId, ownerId, toReject.id);

    const pendingList = await permissionChangeRequestsService.list(tenantId, { status: "pending" });
    expect(pendingList.map((r) => r.id)).toEqual([pending.id]);

    const rejectedList = await permissionChangeRequestsService.list(tenantId, { status: "rejected" });
    expect(rejectedList.map((r) => r.id)).toEqual([toReject.id]);
  });

  it("RbacService's direct methods are unaffected by enforceMakerChecker (only controller-level routing branches)", async () => {
    const { tenantId, ownerId } = await signUpCompany("direct-unaffected");
    await companySettingsService.update(tenantId, ownerId, { settings: { enforceMakerChecker: true } });

    const role = await rbacService.createRole(tenantId, "Viewer", ownerId);
    // Calling RbacService directly (as every other test in this codebase
    // does to set up fixtures) still applies immediately, regardless of
    // the tenant's maker-checker setting — the gate lives in
    // RbacController, not RbacService itself.
    await rbacService.grantPermissionToRole(tenantId, role.id, "admin.role.read", ownerId);
    const roles = await rbacService.listRoles(tenantId);
    expect(roles.find((r) => r.id === role.id)?.permissions).toContain("admin.role.read");
  });
});
