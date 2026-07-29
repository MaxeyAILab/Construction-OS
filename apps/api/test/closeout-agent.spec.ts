import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox, rolePermissions, roles } from "../src/infrastructure/db/schema";
import { buildTestAgentIdentitiesService, buildTestCloseoutAgentRunner } from "./setup/agents";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestFileServices } from "./setup/files";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestTasksServices } from "./setup/tasks";
import { buildTestWarrantyCloseoutServices } from "./setup/warranty-closeout";

// api.md §15.5 "Closeout Agent" (ai-spec.md §15). The daily tick
// (CloseoutAgentRunnerService.runTick, tested directly here rather than
// through CloseoutAgentWorker's BullMQ scheduling) calls the exact same
// CloseoutPackagesService.assemble() a human's :assemble button calls —
// these tests cover the new composition (project-status scoping,
// first-time-only dedupe, kill-switch) not CloseoutPackagesService's own
// gating logic (see warranty-closeout.spec.ts for that).
describe("Closeout Agent: daily tick (assemble closeout package on readiness)", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { tasksService } = buildTestTasksServices(db);
  const { fileUploadService, queueConnection } = buildTestFileServices(db);
  const { checklistService, packagesService, cacheRedis } = buildTestWarrantyCloseoutServices(db, fileUploadService);
  const { agents, redis: agentsRedis } = buildTestAgentIdentitiesService(db);
  const runner = buildTestCloseoutAgentRunner(db, agents, packagesService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await agentsRedis.quit();
    await cacheRedis.quit();
    await queueConnection.quit();
  });

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function signUpCompanyWithProject(label: string, status: "closed" | "warranty" | "active" = "closed") {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `closeout-agent-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `CloseoutAgent ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "500000.00",
    });
    // Status transitions are state-machine gated (planning -> active ->
    // closed -> warranty) — walk the legal path rather than jumping.
    await projectsService.update(signUp.companyId, ownerId, project.id, { status: "active" });
    if (status === "closed" || status === "warranty") {
      await projectsService.update(signUp.companyId, ownerId, project.id, { status: "closed" });
    }
    if (status === "warranty") {
      await projectsService.update(signUp.companyId, ownerId, project.id, { status: "warranty" });
    }
    return { tenantId: signUp.companyId, ownerId, project };
  }

  // The agent's role needs closeout.package.assemble — the same
  // permission a human calling POST .../closeout/package:assemble would
  // need.
  async function createAgentRole(tenantId: string, ownerId: string, name: string) {
    return withTenant(db, tenantId, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId, name, createdBy: ownerId }).returning();
      await tx.insert(rolePermissions).values([{ tenantId, roleId: role!.id, permissionKey: "closeout.package.assemble" }]);
      return role!;
    });
  }

  async function makeReady(tenantId: string, ownerId: string, projectId: string) {
    const item = await checklistService.create(tenantId, ownerId, projectId, { category: "om_manuals", title: "O&M manuals" });
    await checklistService.update(tenantId, ownerId, item.id, { status: "complete" });
  }

  async function outboxRowsFor(tenantId: string, eventType: string) {
    return withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) })).then(
      (rows) => rows.filter((r) => r.eventType === eventType),
    );
  }

  it("assembles a package for a ready 'closed' project, attributed to the agent as actor_type='ai'", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("happy", "closed");
    await makeReady(tenantId, ownerId, project.id);

    const role = await createAgentRole(tenantId, ownerId, "Closeout Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Closeout Agent",
      purpose: "Assembles closeout packages once ready.",
      roleId: role.id,
      toolAllowlist: ["assemble_closeout_package"],
    });

    await runner.runTick();

    const status = await packagesService.getStatus(tenantId, project.id);
    expect(status.currentStatus).toBe("assembled");
    expect(status.history).toHaveLength(1);

    const events = await outboxRowsFor(tenantId, "closeout_package.assembled.v1");
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe(agent.userId);
    expect(events[0]!.actorType).toBe("ai");
  });

  it("does not re-assemble a project that already has a package", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("dedupe", "closed");
    await makeReady(tenantId, ownerId, project.id);

    const role = await createAgentRole(tenantId, ownerId, "Closeout Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Closeout Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["assemble_closeout_package"],
    });

    await runner.runTick();
    await runner.runTick();

    const status = await packagesService.getStatus(tenantId, project.id);
    expect(status.history).toHaveLength(1);
  });

  it("leaves a project alone while its checklist or punch list is incomplete", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("not-ready", "closed");
    await checklistService.create(tenantId, ownerId, project.id, { category: "om_manuals", title: "O&M manuals" });
    await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Fix trim", kind: "punch" });

    const role = await createAgentRole(tenantId, ownerId, "Closeout Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Closeout Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["assemble_closeout_package"],
    });

    await runner.runTick();

    const status = await packagesService.getStatus(tenantId, project.id);
    expect(status.currentStatus).toBe("draft");
  });

  it("ignores a project that isn't post-construction (still 'active')", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("active-scope", "active");
    await makeReady(tenantId, ownerId, project.id);

    const role = await createAgentRole(tenantId, ownerId, "Closeout Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Closeout Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["assemble_closeout_package"],
    });

    await runner.runTick();

    const status = await packagesService.getStatus(tenantId, project.id);
    expect(status.currentStatus).toBe("draft");
  });

  it("skips a paused agent (kill-switch) without erroring the whole tick", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("paused", "warranty");
    await makeReady(tenantId, ownerId, project.id);

    const role = await createAgentRole(tenantId, ownerId, "Closeout Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Closeout Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["assemble_closeout_package"],
    });
    await agents.pause(tenantId, ownerId, agent.id);

    await expect(runner.runTick()).resolves.toBeUndefined();

    const status = await packagesService.getStatus(tenantId, project.id);
    expect(status.currentStatus).toBe("draft");
  });
});
