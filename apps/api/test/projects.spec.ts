import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";

describe("Projects module", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const {
    projectsService,
    projectsQueryService,
    summaryService,
    membersService,
    costCodesService,
    milestonesService,
    templatesService,
  } = buildTestProjectServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await rbacRedis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return authService.signUp({
      email: `projects-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Projects ${label} ${suffix}`,
    });
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function outboxEventTypes(tenantId: string): Promise<string[]> {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    );
    return rows.map((r) => r.eventType);
  }

  it("creates a project, rejects a duplicate code, and lists it", async () => {
    const signUp = await signUpCompany("crud");
    const ownerId = decodeSub(signUp.accessToken);

    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "Riverside Apartments",
      code: "RSA-26",
      currency: "USD",
      startDate: "2026-08-01",
      contractValueAmount: "2450000.00",
    });
    expect(project.status).toBe("planning");
    expect(project.health).toMatchObject({ schedule: null, budget: null });

    await expect(
      projectsService.create(signUp.companyId, ownerId, {
        name: "Duplicate",
        code: "RSA-26",
        currency: "USD",
      }),
    ).rejects.toThrow(/already exists/);

    const list = await projectsQueryService.list(signUp.companyId, {
      limit: 20,
      sort: "-created_at",
    });
    expect(list.data.map((p) => p.id)).toContain(project.id);

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes).toContain("project.created.v1");
  });

  it("optimistic locking: If-Match mismatch is rejected, correct version succeeds", async () => {
    const signUp = await signUpCompany("optlock");
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "Optlock Project",
      code: "OPT-1",
      currency: "USD",
    });

    await expect(
      projectsService.update(
        signUp.companyId,
        ownerId,
        project.id,
        { name: "Renamed" },
        project.updatedSeq + 999,
      ),
    ).rejects.toThrow(/If-Match/);

    const updated = await projectsService.update(
      signUp.companyId,
      ownerId,
      project.id,
      { name: "Renamed" },
      project.updatedSeq,
    );
    expect(updated.name).toBe("Renamed");
    expect(updated.updatedSeq).toBeGreaterThan(project.updatedSeq);
  });

  it("status transitions: legal transition succeeds, illegal one is rejected", async () => {
    const signUp = await signUpCompany("status");
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "Status Project",
      code: "STA-1",
      currency: "USD",
    });

    const active = await projectsService.update(signUp.companyId, ownerId, project.id, {
      status: "active",
    });
    expect(active.status).toBe("active");

    await expect(
      projectsService.update(signUp.companyId, ownerId, project.id, { status: "warranty" }),
    ).rejects.toThrow(/cannot transition/);
  });

  it("soft delete: removed projects disappear from get() and list()", async () => {
    const signUp = await signUpCompany("delete");
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "Doomed Project",
      code: "DEL-1",
      currency: "USD",
    });

    await projectsService.remove(signUp.companyId, ownerId, project.id);

    await expect(projectsService.get(signUp.companyId, project.id)).rejects.toThrow(/not found/);
    const list = await projectsQueryService.list(signUp.companyId, { limit: 50, sort: "-created_at" });
    expect(list.data.map((p) => p.id)).not.toContain(project.id);

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes).toContain("project.deleted.v1");
  });

  it("filters by status and searches by name", async () => {
    const signUp = await signUpCompany("filter");
    const ownerId = decodeSub(signUp.accessToken);
    const alpha = await projectsService.create(signUp.companyId, ownerId, {
      name: "Alpha Tower",
      code: "ALP-1",
      currency: "USD",
    });
    await projectsService.create(signUp.companyId, ownerId, {
      name: "Beta Warehouse",
      code: "BET-1",
      currency: "USD",
    });
    await projectsService.update(signUp.companyId, ownerId, alpha.id, { status: "active" });

    const activeOnly = await projectsQueryService.list(signUp.companyId, {
      limit: 20,
      status: "active",
      sort: "-created_at",
    });
    expect(activeOnly.data.every((p) => p.status === "active")).toBe(true);
    expect(activeOnly.data.map((p) => p.id)).toContain(alpha.id);

    const searched = await projectsQueryService.list(signUp.companyId, {
      limit: 20,
      q: "Alpha",
      sort: "-created_at",
    });
    expect(searched.data.map((p) => p.name)).toEqual(["Alpha Tower"]);
  });

  it("cost codes: builds a WBS tree, rejects duplicate codes on the same project", async () => {
    const signUp = await signUpCompany("costcodes");
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "WBS Project",
      code: "WBS-1",
      currency: "USD",
    });

    const root = await costCodesService.create(signUp.companyId, ownerId, project.id, {
      code: "01",
      name: "General Conditions",
      kind: "other",
    });
    const child = await costCodesService.create(signUp.companyId, ownerId, project.id, {
      code: "01.10",
      name: "Mobilization",
      kind: "labor",
      parentId: root.id,
    });
    expect(child.parentId).toBe(root.id);

    await expect(
      costCodesService.create(signUp.companyId, ownerId, project.id, {
        code: "01",
        name: "Duplicate",
        kind: "other",
      }),
    ).rejects.toThrow(/already exists/);

    const tree = await costCodesService.list(signUp.companyId, project.id);
    expect(tree.map((c) => c.code).sort()).toEqual(["01", "01.10"]);

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes).toContain("cost_code.created.v1");
  });

  it("members: creator is auto-added, add/remove works, duplicates and non-members are rejected", async () => {
    const signUp = await signUpCompany("members");
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "Team Project",
      code: "TEAM-1",
      currency: "USD",
    });

    const initialMembers = await membersService.list(signUp.companyId, project.id);
    expect(initialMembers.map((m) => m.userId)).toEqual([ownerId]);

    const invited = await rbacService.inviteUser(
      signUp.companyId,
      `member-${Date.now()}@example.com`,
      "Team Member",
      ownerId,
    );
    await membersService.add(signUp.companyId, ownerId, project.id, invited.userId);

    const afterAdd = await membersService.list(signUp.companyId, project.id);
    expect(afterAdd.map((m) => m.userId).sort()).toEqual([ownerId, invited.userId].sort());

    await expect(
      membersService.add(signUp.companyId, ownerId, project.id, invited.userId),
    ).rejects.toThrow(/already a member/);

    await membersService.remove(signUp.companyId, ownerId, project.id, invited.userId);
    const afterRemove = await membersService.list(signUp.companyId, project.id);
    expect(afterRemove.map((m) => m.userId)).toEqual([ownerId]);

    await expect(
      membersService.remove(signUp.companyId, ownerId, project.id, invited.userId),
    ).rejects.toThrow(/not a member/);

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes).toContain("project_member.added.v1");
    expect(eventTypes).toContain("project_member.removed.v1");
  });

  it("milestones: creates and marks complete", async () => {
    const signUp = await signUpCompany("milestones");
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "Milestone Project",
      code: "MS-1",
      currency: "USD",
    });

    const milestone = await milestonesService.create(signUp.companyId, ownerId, project.id, {
      name: "Foundation poured",
      dueDate: "2026-09-01",
    });
    expect(milestone.completedAt).toBeNull();

    const completed = await milestonesService.update(
      signUp.companyId,
      ownerId,
      project.id,
      milestone.id,
      { completed: true },
    );
    expect(completed.completedAt).not.toBeNull();

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes).toContain("milestone.created.v1");
  });

  it("templates: applying a template at creation clones its cost codes", async () => {
    const signUp = await signUpCompany("templates");
    const ownerId = decodeSub(signUp.accessToken);

    const template = await templatesService.create(signUp.companyId, ownerId, {
      name: "Standard Commercial",
      manifest: {
        costCodes: [
          { code: "01", name: "General Conditions", kind: "other" },
          { code: "01.10", name: "Mobilization", kind: "labor", parentCode: "01" },
        ],
      },
    });

    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "From Template",
      code: "TPL-1",
      currency: "USD",
      templateId: template.id,
    });

    const codes = await costCodesService.list(signUp.companyId, project.id);
    expect(codes.map((c) => c.code).sort()).toEqual(["01", "01.10"]);
    const child = codes.find((c) => c.code === "01.10")!;
    const root = codes.find((c) => c.code === "01")!;
    expect(child.parentId).toBe(root.id);
  });

  it("summary: aggregates real counts and stubs unbuilt-module fields", async () => {
    const signUp = await signUpCompany("summary");
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: "Summary Project",
      code: "SUM-1",
      currency: "USD",
    });
    await costCodesService.create(signUp.companyId, ownerId, project.id, {
      code: "01",
      name: "GC",
      kind: "other",
    });
    await milestonesService.create(signUp.companyId, ownerId, project.id, { name: "Kickoff" });

    const summary = await summaryService.get(signUp.companyId, project.id);
    expect(summary.team.memberCount).toBe(1);
    expect(summary.costCodes.count).toBe(1);
    expect(summary.milestones.total).toBe(1);
    expect(summary.milestones.completed).toBe(0);
    expect(summary.scheduleVariance).toBeNull();
    expect(summary.margin).toBeNull();
  });

  it("rejects from_opportunity_id (CRM module not built)", async () => {
    const signUp = await signUpCompany("opp");
    const ownerId = decodeSub(signUp.accessToken);
    await expect(
      projectsService.create(signUp.companyId, ownerId, {
        name: "From Opportunity",
        code: "OPP-1",
        currency: "USD",
        fromOpportunityId: "019f8827-d2cf-7571-a0ef-f37cdf282f73",
      }),
    ).rejects.toThrow(/not supported/);
  });

  it("RLS: a tenant only sees its own projects", async () => {
    const companyA = await signUpCompany("rls-a");
    const companyB = await signUpCompany("rls-b");
    const ownerA = decodeSub(companyA.accessToken);

    await projectsService.create(companyA.companyId, ownerA, {
      name: "A Project",
      code: "A-1",
      currency: "USD",
    });

    const rowsB = await withTenant(db, companyB.companyId, (tx) => tx.query.projects.findMany());
    expect(rowsB).toHaveLength(0);
  });
});
