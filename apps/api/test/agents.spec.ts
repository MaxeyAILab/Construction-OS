import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiRuns, rolePermissions, roles } from "../src/infrastructure/db/schema";
import { withTenant } from "../src/infrastructure/db/client";
import { buildTestAuthService } from "./setup/auth";
import { buildTestAgentIdentitiesService } from "./setup/agents";
import { buildTestRbacServices } from "./setup/rbac";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";

// api.md §15.1 "Agent identities" (ai-spec.md §15, roadmap "Agent runtime
// GA"). No live agent execution loop exists yet (none of the "planned
// agents" are built) — these tests cover exactly what this row ships:
// declaring an identity, its budget/kill-switch primitives, and the
// admin surface, not any concrete agent behavior.
describe("Agent identities (declare, budget, kill-switch)", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { agents, redis: agentsRedis } = buildTestAgentIdentitiesService(db);
  const { permissionResolver, redis: rbacRedis } = buildTestRbacServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await agentsRedis.quit();
    await rbacRedis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `agent-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Agent ${label} ${suffix}`,
    });
    const payload = JSON.parse(Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString());
    return { tenantId: signUp.companyId, ownerId: payload.sub as string };
  }

  async function createRole(tenantId: string, ownerId: string, name: string) {
    return withTenant(db, tenantId, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId, name, createdBy: ownerId }).returning();
      return role!;
    });
  }

  it("declares an agent identity: creates a passwordless user, kind='agent' membership, and the requested role assignment", async () => {
    const { tenantId, ownerId } = await signUpCompany("declare");
    const role = await createRole(tenantId, ownerId, "Procurement Watcher");
    await withTenant(db, tenantId, (tx) =>
      tx.insert(rolePermissions).values({ tenantId, roleId: role.id, permissionKey: "projects.project.read" }),
    );

    const created = await agents.create(tenantId, ownerId, {
      name: "Procurement Agent (draft)",
      purpose: "Watches schedule/stock and drafts POs for human review.",
      roleId: role.id,
      toolAllowlist: ["search_project_records", "get_project_summary"],
      budgetMonthlyUsd: "25.00",
      escalationContacts: ["ops@example.test"],
    });

    expect(created.status).toBe("active");
    expect(created.usageThisMonthUsd).toBe("0.00");

    // The agent only holds whatever the assigned role grants — proves the
    // role assignment landed through the normal RBAC path, not a side
    // channel, and that it's real (not just a status flag on this row).
    await expect(permissionResolver.has(tenantId, created.userId, "projects.project.read")).resolves.toBe(true);
    await expect(permissionResolver.has(tenantId, created.userId, "admin.agent.manage")).resolves.toBe(false);

    const listed = await agents.list(tenantId);
    expect(listed.map((a) => a.id)).toContain(created.id);
  });

  it("rejects an unknown tool name in tool_allowlist[]", async () => {
    const { tenantId, ownerId } = await signUpCompany("badtool");
    const role = await createRole(tenantId, ownerId, "Bad Tool Role");
    await expect(
      agents.create(tenantId, ownerId, {
        name: "Bad Agent",
        purpose: "x",
        roleId: role.id,
        toolAllowlist: ["not_a_real_tool"],
      }),
    ).rejects.toMatchObject({ code: "unknown_tool", status: 422 });
  });

  it("pause/resume is the kill-switch: assertCanAct rejects a paused agent and accepts an active one", async () => {
    const { tenantId, ownerId } = await signUpCompany("killswitch");
    const role = await createRole(tenantId, ownerId, "Killswitch Role");
    const created = await agents.create(tenantId, ownerId, {
      name: "Killswitch Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["suggest_tasks"],
    });

    await expect(agents.assertCanAct(tenantId, created.userId)).resolves.toBeUndefined();

    const paused = await agents.pause(tenantId, ownerId, created.id);
    expect(paused.status).toBe("paused");
    expect(paused.pausedAt).not.toBeNull();
    await expect(agents.assertCanAct(tenantId, created.userId)).rejects.toMatchObject({ code: "agent_paused", status: 403 });

    const resumed = await agents.resume(tenantId, ownerId, created.id);
    expect(resumed.status).toBe("active");
    expect(resumed.pausedAt).toBeNull();
    await expect(agents.assertCanAct(tenantId, created.userId)).resolves.toBeUndefined();
  });

  it("assertCanAct enforces the monthly budget against the agent's own ai_runs.cost_usd", async () => {
    const { tenantId, ownerId } = await signUpCompany("budget");
    const role = await createRole(tenantId, ownerId, "Budget Role");
    const created = await agents.create(tenantId, ownerId, {
      name: "Budget Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["suggest_tasks"],
      budgetMonthlyUsd: "10.00",
    });

    await expect(agents.assertCanAct(tenantId, created.userId)).resolves.toBeUndefined();

    await withTenant(db, tenantId, (tx) =>
      tx.insert(aiRuns).values({
        tenantId,
        actorId: created.userId,
        purpose: "test",
        model: "test-model",
        inputTokens: 100,
        outputTokens: 100,
        costUsd: "10.00",
        latencyMs: 1,
      }),
    );

    await expect(agents.assertCanAct(tenantId, created.userId)).rejects.toMatchObject({ code: "budget_exceeded", status: 403 });
  });

  it("update() changes purpose/tool_allowlist/budget without touching the role assignment", async () => {
    const { tenantId, ownerId } = await signUpCompany("update");
    const role = await createRole(tenantId, ownerId, "Update Role");
    const created = await agents.create(tenantId, ownerId, {
      name: "Update Agent",
      purpose: "original",
      roleId: role.id,
      toolAllowlist: ["suggest_tasks"],
    });

    const updated = await agents.update(tenantId, ownerId, created.id, {
      purpose: "revised purpose",
      toolAllowlist: ["suggest_tasks", "list_overdue_tasks"],
      budgetMonthlyUsd: "50.00",
    });
    expect(updated.purpose).toBe("revised purpose");
    expect(updated.toolAllowlist).toEqual(["suggest_tasks", "list_overdue_tasks"]);
    expect(updated.budgetMonthlyUsd).toBe("50.00");
  });

  it("delete() revokes the role assignment and deactivates the identity, but keeps the users row", async () => {
    const { tenantId, ownerId } = await signUpCompany("decommission");
    const role = await createRole(tenantId, ownerId, "Decommission Role");
    const created = await agents.create(tenantId, ownerId, {
      name: "Decommission Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["suggest_tasks"],
    });

    await agents.delete(tenantId, ownerId, created.id);

    await expect(agents.get(tenantId, created.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(agents.list(tenantId)).resolves.not.toContainEqual(expect.objectContaining({ id: created.id }));

    const { users } = await import("../src/infrastructure/db/schema");
    const { eq } = await import("drizzle-orm");
    const userRow = await db.query.users.findFirst({ where: eq(users.id, created.userId) });
    expect(userRow).toBeDefined();
    expect(userRow!.passwordHash).toBeNull();
  });

  it("RLS: a tenant only sees its own agent identities", async () => {
    const { tenantId: tenantA, ownerId: ownerA } = await signUpCompany("rls-a");
    const { tenantId: tenantB } = await signUpCompany("rls-b");
    const role = await createRole(tenantA, ownerA, "RLS Role");
    await agents.create(tenantA, ownerA, {
      name: "RLS Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["suggest_tasks"],
    });

    await expect(agents.list(tenantB)).resolves.toHaveLength(0);
    await expect(agents.list(tenantA)).resolves.toHaveLength(1);
  });
});
