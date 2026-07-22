import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { companyUsers, externalShares } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { buildTestChangeOrderServices } from "./setup/change-orders";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestExternalSharesService } from "./setup/external-shares";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";

describe("Client Portal foundation", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { changeOrdersService, lifecycleService, redis: coRedis } = buildTestChangeOrderServices(db);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const { externalSharesService } = buildTestExternalSharesService(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await coRedis.quit();
    await rbacRedis.quit();
  });

  async function signUpCompanyWithProjectAndBudget(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `portal-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Portal ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    await budgetService.create(signUp.companyId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(signUp.companyId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    return { tenantId: signUp.companyId, ownerId, project, costCode };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function createPendingClientChangeOrder(tenantId: string, ownerId: string, projectId: string, costCodeId: string) {
    const co = await changeOrdersService.create(tenantId, ownerId, projectId, {
      title: "Client-approved scope",
      priceImpactAmount: "2200.00",
      scheduleImpactDays: 2,
      lines: [{ costCodeId, description: "Extra work", costImpactAmount: "2000.00" }],
    });
    await lifecycleService.submitToClient(tenantId, ownerId, co.id);
    return co;
  }

  it("invites a user with kind='external' and persists it", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProjectAndBudget("invite");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId } = await rbacService.inviteUser(
      tenantId,
      `client-${suffix}@example.com`,
      "Client Contact",
      ownerId,
      "external",
    );

    const membership = await withTenant(db, tenantId, (tx) =>
      tx.query.companyUsers.findFirst({ where: and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, userId)) }),
    );
    expect(membership!.kind).toBe("external");
  });

  it("approves a change order via a client-portal share when the caller has no internal permission", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("share-approve");
    const co = await createPendingClientChangeOrder(tenantId, ownerId, project.id, costCode.id);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: clientUserId } = await rbacService.inviteUser(
      tenantId,
      `client-approver-${suffix}@example.com`,
      "Client Approver",
      ownerId,
      "external",
    );
    // No role assigned to clientUserId -- PermissionResolverService.resolve()
    // returns an empty set for them, so only the share path can succeed.

    await externalSharesService.create(tenantId, ownerId, {
      principalUserId: clientUserId,
      audience: "client",
      entityType: "change_order",
      entityId: co.id,
      access: "approve",
    });

    const approved = await lifecycleService.approve(tenantId, clientUserId, co.id);
    expect(approved.status).toBe("approved");
    expect(approved.clientApprovedBy).toBe(clientUserId);
    expect(approved.clientApprovedAt).not.toBeNull();
    expect(approved.clientApprovalChannel).toBe("portal");
  });

  it("rejects approval when the caller has neither the internal permission nor a matching share", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("share-deny");
    const co = await createPendingClientChangeOrder(tenantId, ownerId, project.id, costCode.id);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: bystanderId } = await rbacService.inviteUser(
      tenantId,
      `bystander-${suffix}@example.com`,
      "No Access",
      ownerId,
      "internal",
    );

    await expect(lifecycleService.approve(tenantId, bystanderId, co.id)).rejects.toThrow(/finance\.co\.approve/);
  });

  it("a share scoped to one access level doesn't grant a different one", async () => {
    const { tenantId, ownerId, project, costCode } = await signUpCompanyWithProjectAndBudget("share-wrong-access");
    const co = await createPendingClientChangeOrder(tenantId, ownerId, project.id, costCode.id);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: viewerId } = await rbacService.inviteUser(
      tenantId,
      `viewer-${suffix}@example.com`,
      "View Only",
      ownerId,
      "external",
    );
    await externalSharesService.create(tenantId, ownerId, {
      principalUserId: viewerId,
      audience: "client",
      entityType: "change_order",
      entityId: co.id,
      access: "view",
    });

    await expect(lifecycleService.approve(tenantId, viewerId, co.id)).rejects.toThrow(/finance\.co\.approve/);
  });

  it("RLS: a tenant only sees its own external_shares", async () => {
    const a = await signUpCompanyWithProjectAndBudget("rls-a");
    const b = await signUpCompanyWithProjectAndBudget("rls-b");
    const co = await createPendingClientChangeOrder(a.tenantId, a.ownerId, a.project.id, a.costCode.id);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId: clientUserId } = await rbacService.inviteUser(
      a.tenantId,
      `rls-client-${suffix}@example.com`,
      "RLS Client",
      a.ownerId,
      "external",
    );
    await externalSharesService.create(a.tenantId, a.ownerId, {
      principalUserId: clientUserId,
      audience: "client",
      entityType: "change_order",
      entityId: co.id,
      access: "approve",
    });

    const sharesB = await withTenant(db, b.tenantId, (tx) => tx.query.externalShares.findMany());
    expect(sharesB).toHaveLength(0);

    const sharesA = await withTenant(db, a.tenantId, (tx) =>
      tx.query.externalShares.findMany({ where: eq(externalShares.tenantId, a.tenantId) }),
    );
    expect(sharesA).toHaveLength(1);
  });
});
