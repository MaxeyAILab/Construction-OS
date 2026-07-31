import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestCustomFieldsServices } from "./setup/custom-fields";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRbacServices } from "./setup/rbac";
import { buildTestTasksServices } from "./setup/tasks";

// database.md §24 / api.md §19 (M18, FR-PLAT-11/12). Guard-rails under
// test: the entity_type allow-list, typed value validation, per-entity-type
// permission resolution (no single fixed permission), and the automation
// engine's equality-only trigger + fixed action vocabulary + no-chaining
// rule (roadmap V2 risk register: "no arbitrary scripting").
describe("Custom Fields & Workflows (M18)", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { rbacService, permissionResolver, redis: rbacRedis } = buildTestRbacServices(db);
  const { projectsService } = buildTestProjectServices(db);
  const { tasksService } = buildTestTasksServices(db);
  const { definitionsService, valuesService } = buildTestCustomFieldsServices(db, permissionResolver);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await rbacRedis.quit();
  });

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function signUpCompanyWithProjectAndTask(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `cf-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `CF ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    const task = await tasksService.create(signUp.companyId, ownerId, {
      projectId: project.id,
      title: `${label} task`,
    });
    return { tenantId: signUp.companyId, ownerId, project, task };
  }

  async function outboxEventTypes(tenantId: string): Promise<string[]> {
    const rows = await withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }));
    return rows.map((r) => r.eventType);
  }

  async function latestOutboxPayload(tenantId: string, eventType: string) {
    const row = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findFirst({
        where: and(eq(outbox.tenantId, tenantId), eq(outbox.eventType, eventType)),
        orderBy: (o, { desc }) => [desc(o.occurredAt)],
      }),
    );
    if (!row) throw new Error(`no ${eventType} outbox row found for tenant ${tenantId}`);
    return row.payload as Record<string, unknown>;
  }

  it("defines a field, rejects a duplicate key, and lists it for its entity type", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProjectAndTask("define");

    const field = await definitionsService.create(tenantId, ownerId, {
      entityType: "task",
      fieldKey: "risk_level",
      label: "Risk Level",
      fieldType: "select",
      options: ["low", "medium", "high"],
    });
    expect(field.fieldKey).toBe("risk_level");

    await expect(
      definitionsService.create(tenantId, ownerId, {
        entityType: "task",
        fieldKey: "risk_level",
        label: "Risk Level (dup)",
        fieldType: "text",
      }),
    ).rejects.toThrow(/already exists/i);

    const list = await definitionsService.list(tenantId, "task");
    expect(list.map((d) => d.fieldKey)).toContain("risk_level");
    expect(await outboxEventTypes(tenantId)).toContain("custom_field_definition.created.v1");
  });

  it("sets a typed value on an entity and rejects a value outside the field's shape", async () => {
    const { tenantId, ownerId, task } = await signUpCompanyWithProjectAndTask("values");
    const field = await definitionsService.create(tenantId, ownerId, {
      entityType: "task",
      fieldKey: "budget_flag",
      label: "Budget Flag",
      fieldType: "boolean",
    });

    await valuesService.setValue(tenantId, ownerId, {
      entityType: "task",
      entityId: task.id,
      fieldId: field.id,
      value: true,
    });

    const values = await valuesService.list(tenantId, ownerId, "task", task.id);
    const row = values.find((v) => v.fieldId === field.id);
    expect(row?.value).toBe(true);

    await expect(
      valuesService.setValue(tenantId, ownerId, {
        entityType: "task",
        entityId: task.id,
        fieldId: field.id,
        value: "not-a-boolean" as unknown as boolean,
      }),
    ).rejects.toThrow(/expects a boolean/i);
  });

  it("rejects a select value outside its declared options", async () => {
    const { tenantId, ownerId, task } = await signUpCompanyWithProjectAndTask("select");
    const field = await definitionsService.create(tenantId, ownerId, {
      entityType: "task",
      fieldKey: "priority",
      label: "Priority",
      fieldType: "select",
      options: ["low", "high"],
    });

    await expect(
      valuesService.setValue(tenantId, ownerId, {
        entityType: "task",
        entityId: task.id,
        fieldId: field.id,
        value: "medium",
      }),
    ).rejects.toThrow(/expects one of/i);
  });

  it("resolves the per-entity-type permission and denies a user without it (no single fixed permission)", async () => {
    const { tenantId, ownerId, task } = await signUpCompanyWithProjectAndTask("perm");
    const field = await definitionsService.create(tenantId, ownerId, {
      entityType: "task",
      fieldKey: "notes",
      label: "Notes",
      fieldType: "text",
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const invited = await rbacService.inviteUser(tenantId, `bystander-${suffix}@example.com`, "Bystander", ownerId);

    await expect(
      valuesService.setValue(tenantId, invited.userId, {
        entityType: "task",
        entityId: task.id,
        fieldId: field.id,
        value: "hello",
      }),
    ).rejects.toThrow(/tasks\.task\.update/);

    await expect(valuesService.list(tenantId, invited.userId, "task", task.id)).rejects.toThrow(/tasks\.task\.read/);
  });

  it("automation: set_field action fires on an equality match and never re-triggers evaluation", async () => {
    const { tenantId, ownerId, task } = await signUpCompanyWithProjectAndTask("automation-set");
    const trigger = await definitionsService.create(tenantId, ownerId, {
      entityType: "task",
      fieldKey: "escalated",
      label: "Escalated",
      fieldType: "boolean",
    });
    const derived = await definitionsService.create(tenantId, ownerId, {
      entityType: "task",
      fieldKey: "needs_review",
      label: "Needs Review",
      fieldType: "boolean",
    });

    await definitionsService.create(tenantId, ownerId, {
      entityType: "task",
      fieldKey: "unrelated",
      label: "Unrelated",
      fieldType: "boolean",
    });

    const { automationsService: automations } = buildTestCustomFieldsServices(db, permissionResolver);
    await automations.create(tenantId, ownerId, {
      entityType: "task",
      name: "Escalate flags review",
      triggerFieldId: trigger.id,
      triggerValue: true,
      actionType: "set_field",
      actionFieldId: derived.id,
      actionValue: true,
    });

    await valuesService.setValue(tenantId, ownerId, {
      entityType: "task",
      entityId: task.id,
      fieldId: trigger.id,
      value: true,
    });

    const values = await valuesService.list(tenantId, ownerId, "task", task.id);
    expect(values.find((v) => v.fieldId === derived.id)?.value).toBe(true);

    // The set_field write goes straight to custom_field_values (no
    // automations trigger off it), so exactly one automation_triggered
    // event exists for this run, not a cascade.
    const triggeredCount = (await outboxEventTypes(tenantId)).filter(
      (t) => t === "custom_field_automation.triggered.v1",
    ).length;
    expect(triggeredCount).toBe(1);
  });

  it("automation: notify_user action emits a triggered event carrying the notify target", async () => {
    const { tenantId, ownerId, task } = await signUpCompanyWithProjectAndTask("automation-notify");
    const trigger = await definitionsService.create(tenantId, ownerId, {
      entityType: "task",
      fieldKey: "blocked",
      label: "Blocked",
      fieldType: "boolean",
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const invited = await rbacService.inviteUser(tenantId, `notify-${suffix}@example.com`, "Notify Target", ownerId);

    const { automationsService } = buildTestCustomFieldsServices(db, permissionResolver);
    await automationsService.create(tenantId, ownerId, {
      entityType: "task",
      name: "Notify on blocked",
      triggerFieldId: trigger.id,
      triggerValue: true,
      actionType: "notify_user",
      actionNotifyUserId: invited.userId,
    });

    await valuesService.setValue(tenantId, ownerId, {
      entityType: "task",
      entityId: task.id,
      fieldId: trigger.id,
      value: true,
    });

    const payload = await latestOutboxPayload(tenantId, "custom_field_automation.triggered.v1");
    expect(payload.actionType).toBe("notify_user");
    expect(payload.notifyUserId).toBe(invited.userId);
  });

  it("rejects an automation whose trigger/action field doesn't belong to its entity_type", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProjectAndTask("mismatch");
    const projectField = await definitionsService.create(tenantId, ownerId, {
      entityType: "project",
      fieldKey: "phase",
      label: "Phase",
      fieldType: "text",
    });

    const { automationsService: automations } = buildTestCustomFieldsServices(db, permissionResolver);
    await expect(
      automations.create(tenantId, ownerId, {
        entityType: "task",
        name: "Cross-entity trigger",
        triggerFieldId: projectField.id,
        triggerValue: "closeout",
        actionType: "notify_user",
        actionNotifyUserId: ownerId,
      }),
    ).rejects.toThrow(/does not belong/i);
  });
});
