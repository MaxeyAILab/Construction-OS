import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSafetyServices } from "./setup/safety";

// M12 Safety & Compliance (FR-SAFE-1..3, database.md §15, spec.md §13.12).
describe("Safety & Compliance", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { templatesService, formsService, incidentsService, certificationsService, tasksService } =
    buildTestSafetyServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `safety-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Safety ${label} ${suffix}`,
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

  it("creates a safety form template and a filled form against it (FR-SAFE-1)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("forms");
    const template = await templatesService.create(tenantId, ownerId, {
      name: "Daily Toolbox Talk",
      kind: "toolbox_talk",
      schema: { fields: [{ key: "topic", type: "text" }] },
    });
    expect(template.kind).toBe("toolbox_talk");

    const form = await formsService.create(tenantId, ownerId, project.id, {
      templateId: template.id,
      responses: { topic: "Ladder safety" },
    });
    expect(form.projectId).toBe(project.id);

    const page = await formsService.listForProject(tenantId, project.id, { limit: 10 });
    expect(page.data).toHaveLength(1);
  });

  it("supports an offline client-generated id on a submitted form", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("offline-forms");
    const template = await templatesService.create(tenantId, ownerId, {
      name: "Daily Inspection",
      kind: "inspection",
      schema: { fields: [] },
    });

    const explicitId = crypto.randomUUID();
    const form = await formsService.create(
      tenantId,
      ownerId,
      project.id,
      { templateId: template.id, responses: {} },
      explicitId,
    );
    expect(form.id).toBe(explicitId);
  });

  it("reports an incident and routes it to a corrective-action task exactly once (FR-SAFE-3)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("incident");
    const incident = await incidentsService.create(tenantId, ownerId, project.id, {
      kind: "near_miss",
      severity: "high",
      occurredAt: new Date().toISOString(),
      description: "Worker nearly struck by falling material",
    });
    expect(incident.status).toBe("open");
    expect(incident.correctiveActionTaskId).toBeNull();

    const routed = await incidentsService.routeCorrectiveAction(tenantId, ownerId, incident.id, {
      title: "Install debris netting",
    });
    expect(routed.correctiveActionTaskId).not.toBeNull();

    const task = await tasksService.getById(tenantId, routed.correctiveActionTaskId!);
    expect(task.projectId).toBe(project.id);
    expect(task.title).toBe("Install debris netting");

    await expect(
      incidentsService.routeCorrectiveAction(tenantId, ownerId, incident.id, { title: "Second attempt" }),
    ).rejects.toThrow(/already has a corrective action/);
  });

  it("filters incidents by severity and status via the pull-based feed (FR-SAFE-3 management notification)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("incident-feed");
    await incidentsService.create(tenantId, ownerId, project.id, {
      kind: "observation",
      severity: "low",
      occurredAt: new Date().toISOString(),
    });
    const critical = await incidentsService.create(tenantId, ownerId, project.id, {
      kind: "incident",
      severity: "critical",
      occurredAt: new Date().toISOString(),
      oshaRecordable: true,
    });

    const page = await incidentsService.listForProject(tenantId, project.id, { severity: "critical", limit: 10 });
    expect(page.data.map((i) => i.id)).toEqual([critical.id]);
  });

  it("closes an incident via update", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("incident-close");
    const incident = await incidentsService.create(tenantId, ownerId, project.id, {
      kind: "observation",
      occurredAt: new Date().toISOString(),
    });
    const closed = await incidentsService.update(tenantId, ownerId, incident.id, { status: "closed" });
    expect(closed.status).toBe("closed");
  });

  it("tracks certification expiry due-state (FR-SAFE-2)", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("certs");
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const far = new Date();
    far.setDate(far.getDate() + 300);
    const past = new Date();
    past.setDate(past.getDate() - 5);

    await certificationsService.create(tenantId, ownerId, {
      holderName: "Jane Foreman",
      certType: "OSHA-30",
      expiresAt: soon.toISOString().slice(0, 10),
    });
    await certificationsService.create(tenantId, ownerId, {
      holderName: "Jane Foreman",
      certType: "First Aid/CPR",
      expiresAt: far.toISOString().slice(0, 10),
    });
    const expired = await certificationsService.create(tenantId, ownerId, {
      holderName: "Retired Sub",
      certType: "General Liability Insurance",
      expiresAt: past.toISOString().slice(0, 10),
    });

    const all = await certificationsService.list(tenantId, { limit: 10 });
    const states = Object.fromEntries(all.data.map((c) => [c.certType, c.dueState]));
    expect(states["OSHA-30"]).toBe("expiring_soon");
    expect(states["First Aid/CPR"]).toBe("valid");
    expect(states["General Liability Insurance"]).toBe("expired");

    const expiringOnly = await certificationsService.list(tenantId, { expiringOnly: true, limit: 10 });
    expect(expiringOnly.data.map((c) => c.id).sort()).toEqual(
      [expired.id, all.data.find((c) => c.certType === "OSHA-30")!.id].sort(),
    );
  });

  it("renews a certification", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("cert-renew");
    const cert = await certificationsService.create(tenantId, ownerId, {
      holderName: "Sam Rigger",
      certType: "Crane Operator",
      expiresAt: "2020-01-01",
    });
    const renewed = await certificationsService.update(tenantId, ownerId, cert.id, { expiresAt: "2030-01-01" });
    expect(renewed.expiresAt).toBe("2030-01-01");
  });

  it("enforces tenant isolation for incidents", async () => {
    const { tenantId: tenantA, ownerId: ownerA, project: projectA } = await signUpCompanyWithProject("iso-a");
    const { tenantId: tenantB } = await signUpCompanyWithProject("iso-b");
    const incident = await incidentsService.create(tenantA, ownerA, projectA.id, {
      kind: "incident",
      occurredAt: new Date().toISOString(),
    });

    await expect(incidentsService.getById(tenantB, incident.id)).rejects.toThrow(/not found/);
  });
});
