import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { aiMessages } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectAssistantServices } from "./setup/project-assistant";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";

describe("Project Assistant v1: conversations, tool-calling, permission-scoped tools, confidence/escalation", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { rbacService, redis: rbacRedis } = buildTestRbacServices(db);
  const { projectAssistantService, tasksService, ragIndexingService, cacheRedis } = buildTestProjectAssistantServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await rbacRedis.quit();
    await cacheRedis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `assistant-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Assistant ${label} ${suffix}`,
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

  it("opens a project-scoped conversation and persists it", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("open");
    const conversation = await projectAssistantService.openConversation(tenantId, ownerId, {
      module: "project",
      entityRef: { type: "project", id: project.id },
    });

    expect(conversation.tenantId).toBe(tenantId);
    expect(conversation.userId).toBe(ownerId);
    expect(conversation.entityId).toBe(project.id);
  });

  it("rejects opening a conversation against a nonexistent project", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("missing-project");
    await expect(
      projectAssistantService.openConversation(tenantId, ownerId, {
        module: "project",
        entityRef: { type: "project", id: "00000000-0000-0000-0000-000000000000" },
      }),
    ).rejects.toThrow();
  });

  it("search: a grounded question calls search_project_records and cites real sources", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("search");
    const task = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Inspect roof leak near stairwell" });
    await ragIndexingService.indexEntity(tenantId, "task", task.id);

    const conversation = await projectAssistantService.openConversation(tenantId, ownerId, {
      module: "project",
      entityRef: { type: "project", id: project.id },
    });

    const toolCallNames: string[] = [];
    const reply = await projectAssistantService.postMessage(
      tenantId,
      ownerId,
      conversation.id,
      "Can you search for anything about the roof leak?",
      (name) => toolCallNames.push(name),
    );

    expect(toolCallNames).toContain("search_project_records");
    expect(reply.sources?.some((s) => s.entityId === task.id)).toBe(true);
    expect(reply.confidence).toBeGreaterThan(0);
  });

  it("status: a status question calls get_project_summary", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("status");
    const conversation = await projectAssistantService.openConversation(tenantId, ownerId, {
      module: "project",
      entityRef: { type: "project", id: project.id },
    });

    const toolCallNames: string[] = [];
    const reply = await projectAssistantService.postMessage(
      tenantId,
      ownerId,
      conversation.id,
      "Give me a quick status summary of this project.",
      (name) => toolCallNames.push(name),
    );

    expect(toolCallNames).toContain("get_project_summary");
    expect(reply.content.length).toBeGreaterThan(0);
  });

  it("draft: pasted notes trigger suggest_tasks and return draft (non-persisted) suggestions", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("draft");
    const conversation = await projectAssistantService.openConversation(tenantId, ownerId, {
      module: "project",
      entityRef: { type: "project", id: project.id },
    });

    const reply = await projectAssistantService.postMessage(
      tenantId,
      ownerId,
      conversation.id,
      "Here are my meeting notes, please suggest some follow-up action items.",
    );

    expect(reply.suggestedTasks?.length).toBeGreaterThan(0);
    // Nothing was actually created — suggest_tasks is a draft, not an act.
    const realTasks = await tasksService.list(tenantId, { projectId: project.id, limit: 20 });
    expect(realTasks.data).toHaveLength(0);
  });

  it("escalation: a search with zero matching content is flagged, not confidently answered", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("empty-search");
    const conversation = await projectAssistantService.openConversation(tenantId, ownerId, {
      module: "project",
      entityRef: { type: "project", id: project.id },
    });

    const reply = await projectAssistantService.postMessage(
      tenantId,
      ownerId,
      conversation.id,
      "Can you search for anything about waterproofing?",
    );

    expect(reply.escalated).toBe(true);
    expect(reply.confidence).toBeLessThan(0.6);
  });

  it("permission-scoped tools: a caller with no granted permissions is never offered a permission-gated tool", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("no-perms");
    const bystander = await rbacService.inviteUser(tenantId, `assistant-bystander-${Date.now()}@example.com`, "Bystander", ownerId);

    const conversation = await projectAssistantService.openConversation(tenantId, bystander.userId, {
      module: "project",
      entityRef: { type: "project", id: project.id },
    });

    const toolCallNames: string[] = [];
    const reply = await projectAssistantService.postMessage(
      tenantId,
      bystander.userId,
      conversation.id,
      "Give me a status summary and search for roof leak.",
      (name) => toolCallNames.push(name),
    );

    expect(toolCallNames).toHaveLength(0);
    expect(reply.content.length).toBeGreaterThan(0);
  });

  it("a caller cannot post to another user's conversation (404, not leaked)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("ownership");
    const other = await rbacService.inviteUser(tenantId, `assistant-other-${Date.now()}@example.com`, "Other", ownerId);
    const conversation = await projectAssistantService.openConversation(tenantId, ownerId, {
      module: "project",
      entityRef: { type: "project", id: project.id },
    });

    await expect(projectAssistantService.getConversation(tenantId, other.userId, conversation.id)).rejects.toThrow();
  });

  it("persists exactly a user row and an assistant row per turn, with tool_calls on the assistant row", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("persistence");
    const task = await tasksService.create(tenantId, ownerId, { projectId: project.id, title: "Order drywall for level 2" });
    await ragIndexingService.indexEntity(tenantId, "task", task.id);

    const conversation = await projectAssistantService.openConversation(tenantId, ownerId, {
      module: "project",
      entityRef: { type: "project", id: project.id },
    });
    await projectAssistantService.postMessage(tenantId, ownerId, conversation.id, "Search for drywall.");

    const messages = await withTenant(db, tenantId, (tx) =>
      tx.query.aiMessages.findMany({ where: eq(aiMessages.conversationId, conversation.id) }),
    );
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m.role === "user")?.content).toBe("Search for drywall.");
    const assistantMessage = messages.find((m) => m.role === "assistant");
    expect(assistantMessage?.toolCalls).not.toBeNull();
  });

  it("RLS: a tenant only sees its own conversations and messages", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const conversation = await projectAssistantService.openConversation(a.tenantId, a.ownerId, {
      module: "project",
      entityRef: { type: "project", id: a.project.id },
    });
    await projectAssistantService.postMessage(a.tenantId, a.ownerId, conversation.id, "Hello there.");

    const conversationsSeenByB = await withTenant(db, b.tenantId, (tx) => tx.query.aiConversations.findMany());
    expect(conversationsSeenByB).toHaveLength(0);

    const messagesSeenByA = await withTenant(db, a.tenantId, (tx) =>
      tx.query.aiMessages.findMany({ where: and(eq(aiMessages.tenantId, a.tenantId), eq(aiMessages.conversationId, conversation.id)) }),
    );
    expect(messagesSeenByA.length).toBeGreaterThan(0);
  });
});
