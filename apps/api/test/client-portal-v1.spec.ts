import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestClientPortalServices } from "./setup/client-portal";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestExternalSharesService } from "./setup/external-shares";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";

describe("Client Portal v1: selections + portal messages", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { selectionsService, portalMessagesService, cacheRedis } = buildTestClientPortalServices(db);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const { externalSharesService } = buildTestExternalSharesService(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await cacheRedis.quit();
    await rbacRedis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `cpv1-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `CPv1 ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    return { tenantId: signUp.companyId, ownerId, project };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function inviteExternalUser(tenantId: string, actorId: string, label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { userId } = await rbacService.inviteUser(tenantId, `${label}-${suffix}@example.com`, "Client", actorId, "external");
    return userId;
  }

  async function outboxEventTypes(tenantId: string): Promise<string[]> {
    const rows = await withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }));
    return rows.map((r) => r.eventType);
  }

  it("creates and lists selections for a project (internal)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("crud");
    const selection = await selectionsService.create(tenantId, ownerId, project.id, {
      title: "Kitchen countertop",
      options: [
        { label: "Laminate", costImpactAmount: "0.00" },
        { label: "Quartz", costImpactAmount: "3500.00" },
      ],
      allowanceAmount: "1000.00",
    });
    expect(selection.status).toBe("pending");

    const list = await selectionsService.list(tenantId, ownerId, project.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(selection.id);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("client_selection.created.v1");
  });

  it("rejects listing selections for a caller with neither permission nor share", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("deny-read");
    const bystanderId = await inviteExternalUser(tenantId, ownerId, "bystander");

    await expect(selectionsService.list(tenantId, bystanderId, project.id)).rejects.toThrow(/client\.selection/);
  });

  it("a client with a project-level view share can list and get selections", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("share-read");
    const selection = await selectionsService.create(tenantId, ownerId, project.id, {
      title: "Flooring",
      options: [{ label: "Tile", costImpactAmount: "0.00" }],
    });
    const clientId = await inviteExternalUser(tenantId, ownerId, "client-read");
    await externalSharesService.create(tenantId, ownerId, {
      principalUserId: clientId,
      audience: "client",
      entityType: "project",
      entityId: project.id,
      access: "view",
    });

    const list = await selectionsService.list(tenantId, clientId, project.id);
    expect(list).toHaveLength(1);

    const fetched = await selectionsService.getById(tenantId, clientId, selection.id);
    expect(fetched.id).toBe(selection.id);
  });

  it("decides a selection internally, computing the cost delta against the allowance", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("decide-internal");
    const selection = await selectionsService.create(tenantId, ownerId, project.id, {
      title: "Cabinets",
      options: [
        { label: "Standard", costImpactAmount: "0.00" },
        { label: "Custom", costImpactAmount: "4200.00" },
      ],
      allowanceAmount: "1000.00",
    });

    const decided = await selectionsService.decide(tenantId, ownerId, selection.id, { selectedOption: "Custom" });
    expect(decided.status).toBe("decided");
    expect(decided.selectedOption).toBe("Custom");
    expect(decided.decidedBy).toBe(ownerId);
    expect(decided.decidedAt).not.toBeNull();

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("client_selection.decided.v1");
  });

  it("decides a selection via a per-selection approve share, with no internal permission", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("decide-share");
    const selection = await selectionsService.create(tenantId, ownerId, project.id, {
      title: "Fixtures",
      options: [{ label: "Brushed nickel", costImpactAmount: "150.00" }],
    });
    const clientId = await inviteExternalUser(tenantId, ownerId, "client-decide");
    await externalSharesService.create(tenantId, ownerId, {
      principalUserId: clientId,
      audience: "client",
      entityType: "client_selection",
      entityId: selection.id,
      access: "approve",
    });

    const decided = await selectionsService.decide(tenantId, clientId, selection.id, { selectedOption: "Brushed nickel" });
    expect(decided.status).toBe("decided");
    expect(decided.decidedBy).toBe(clientId);
  });

  it("rejects deciding an already-decided selection", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("decide-twice");
    const selection = await selectionsService.create(tenantId, ownerId, project.id, {
      title: "Paint",
      options: [{ label: "White", costImpactAmount: "0.00" }],
    });
    await selectionsService.decide(tenantId, ownerId, selection.id, { selectedOption: "White" });

    await expect(selectionsService.decide(tenantId, ownerId, selection.id, { selectedOption: "White" })).rejects.toThrow(
      /already been decided/,
    );
  });

  it("rejects an option label that isn't one of the selection's options", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("bad-option");
    const selection = await selectionsService.create(tenantId, ownerId, project.id, {
      title: "Hardware",
      options: [{ label: "Matte black", costImpactAmount: "0.00" }],
    });

    await expect(
      selectionsService.decide(tenantId, ownerId, selection.id, { selectedOption: "Chrome" }),
    ).rejects.toThrow(/not one of this selection's options/);
  });

  it("portal messages: an internal user and a client (via a comment share) both post to the same thread", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("messages");
    const clientId = await inviteExternalUser(tenantId, ownerId, "client-msg");
    await externalSharesService.create(tenantId, ownerId, {
      principalUserId: clientId,
      audience: "client",
      entityType: "project",
      entityId: project.id,
      access: "comment",
    });

    await portalMessagesService.create(tenantId, ownerId, project.id, { body: "Please review the attached selection." });
    await portalMessagesService.create(tenantId, clientId, project.id, { body: "Looks good, approved." });

    const thread = await portalMessagesService.list(tenantId, ownerId, project.id);
    expect(thread).toHaveLength(2);
    expect(thread.map((m) => m.body)).toEqual(["Please review the attached selection.", "Looks good, approved."]);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes.filter((t) => t === "portal_message.created.v1")).toHaveLength(2);
  });

  it("rejects posting a portal message for a caller with neither permission nor a comment share", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("messages-deny");
    const bystanderId = await inviteExternalUser(tenantId, ownerId, "bystander-msg");

    await expect(
      portalMessagesService.create(tenantId, bystanderId, project.id, { body: "hi" }),
    ).rejects.toThrow(/client\.message\.create/);
  });

  it("a view-only share can read messages but not post", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("messages-view-only");
    const clientId = await inviteExternalUser(tenantId, ownerId, "client-view-only");
    await externalSharesService.create(tenantId, ownerId, {
      principalUserId: clientId,
      audience: "client",
      entityType: "project",
      entityId: project.id,
      access: "view",
    });
    await portalMessagesService.create(tenantId, ownerId, project.id, { body: "Welcome to the portal." });

    const thread = await portalMessagesService.list(tenantId, clientId, project.id);
    expect(thread).toHaveLength(1);

    await expect(portalMessagesService.create(tenantId, clientId, project.id, { body: "hi" })).rejects.toThrow(
      /client\.message\.create/,
    );
  });

  it("RLS: a tenant only sees its own client_selections and portal_messages", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await selectionsService.create(a.tenantId, a.ownerId, a.project.id, {
      title: "A-only",
      options: [{ label: "X", costImpactAmount: "0.00" }],
    });
    await portalMessagesService.create(a.tenantId, a.ownerId, a.project.id, { body: "A-only message" });

    const selectionsB = await withTenant(db, b.tenantId, (tx) => tx.query.clientSelections.findMany());
    expect(selectionsB).toHaveLength(0);

    const messagesB = await withTenant(db, b.tenantId, (tx) => tx.query.portalMessages.findMany());
    expect(messagesB).toHaveLength(0);

    const selectionsA = await withTenant(db, a.tenantId, (tx) => tx.query.clientSelections.findMany());
    expect(selectionsA.length).toBeGreaterThan(0);
  });
});
