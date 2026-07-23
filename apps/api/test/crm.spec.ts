import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { contacts, opportunities } from "../src/infrastructure/db/schema";
import { buildTestAuditServices } from "./setup/audit";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestCrmServices } from "./setup/crm";
import { buildTestProjectServices } from "./setup/projects";

// M1 CRM & Pre-Construction (FR-CRM-1/2/4, database.md §8, api.md §4).
describe("CRM & Pre-Construction v1", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const {
    contactsService,
    contactCompaniesService,
    pipelineStagesService,
    opportunitiesService,
    lifecycleService,
    activitiesService,
  } = buildTestCrmServices(db, projectsService);
  const { auditWriterService } = buildTestAuditServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `crm-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `CRM ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    return { tenantId: signUp.companyId, ownerId };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function replayLatestOutboxEvent(tenantId: string, eventType: string) {
    const row = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findFirst({ where: (o, { and, eq: eqOp }) => and(eqOp(o.tenantId, tenantId), eqOp(o.eventType, eventType)) }),
    );
    if (!row) throw new Error(`no ${eventType} outbox row found for tenant ${tenantId}`);
    return {
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType,
      payload: row.payload,
      dedupeKey: row.dedupeKey,
      occurredAt: row.occurredAt.toISOString(),
      actorId: row.actorId,
      actorType: row.actorType as "user" | "system" | "ai" | "integration",
    };
  }

  it("creates a contact company and a contact linked to it, searchable by name/email", async () => {
    const { tenantId, ownerId } = await signUpCompany("contacts");
    const company = await contactCompaniesService.create(tenantId, ownerId, { name: "Riverside Architects" });
    const contact = await contactsService.create(tenantId, ownerId, {
      firstName: "Jamie",
      lastName: "Rivera",
      email: "jamie@riverside-arch.example",
      contactCompanyId: company.id,
      kind: "architect",
    });
    expect(contact.contactCompanyId).toBe(company.id);

    const byName = await contactsService.list(tenantId, { q: "Rivera", limit: 20 });
    expect(byName.data.map((c) => c.id)).toContain(contact.id);

    const byEmail = await contactsService.list(tenantId, { q: "riverside-arch", limit: 20 });
    expect(byEmail.data.map((c) => c.id)).toContain(contact.id);

    const byCompany = await contactsService.list(tenantId, { contactCompanyId: company.id, limit: 20 });
    expect(byCompany.data.map((c) => c.id)).toEqual([contact.id]);
  });

  it("creates ordered pipeline stages and an opportunity assigned to one", async () => {
    const { tenantId, ownerId } = await signUpCompany("pipeline");
    const stage1 = await pipelineStagesService.create(tenantId, ownerId, { name: "Lead", displayOrder: 1 });
    await pipelineStagesService.create(tenantId, ownerId, { name: "Qualified", displayOrder: 2 });
    await pipelineStagesService.create(tenantId, ownerId, { name: "Proposal", displayOrder: 3 });

    const stages = await pipelineStagesService.list(tenantId);
    expect(stages.map((s) => s.name)).toEqual(["Lead", "Qualified", "Proposal"]);

    const opportunity = await opportunitiesService.create(tenantId, ownerId, {
      name: "Riverside Apartments",
      stageId: stage1.id,
      expectedValueAmount: "250000.00",
      currency: "USD",
    });
    expect(opportunity.status).toBe("open");
    expect(opportunity.stageId).toBe(stage1.id);

    const { data } = await opportunitiesService.list(tenantId, { stageId: stage1.id, status: "open", limit: 20 });
    expect(data.map((o) => o.id)).toContain(opportunity.id);
  });

  it("moves an opportunity to a new stage via PATCH, audited as one generic update", async () => {
    const { tenantId, ownerId } = await signUpCompany("stage-move");
    const lead = await pipelineStagesService.create(tenantId, ownerId, { name: "Lead", displayOrder: 1 });
    const qualified = await pipelineStagesService.create(tenantId, ownerId, { name: "Qualified", displayOrder: 2 });
    const opportunity = await opportunitiesService.create(tenantId, ownerId, {
      name: "Harbor Office",
      stageId: lead.id,
      expectedValueAmount: "80000.00",
    });

    const moved = await opportunitiesService.update(tenantId, ownerId, opportunity.id, { stageId: qualified.id });
    expect(moved.stageId).toBe(qualified.id);

    const envelope = await replayLatestOutboxEvent(tenantId, "opportunity.updated.v1");
    expect((envelope.payload as { changedFields: string[] }).changedFields).toEqual(["stageId"]);
  });

  it("wins an opportunity: atomically creates a project and links wonProjectId (FR-CRM-4)", async () => {
    const { tenantId, ownerId } = await signUpCompany("win");
    const company = await contactCompaniesService.create(tenantId, ownerId, { name: "Harbor Development LLC" });
    const stage = await pipelineStagesService.create(tenantId, ownerId, { name: "Negotiation", displayOrder: 1 });
    const opportunity = await opportunitiesService.create(tenantId, ownerId, {
      name: "Harbor Tower",
      contactCompanyId: company.id,
      stageId: stage.id,
      expectedValueAmount: "1500000.00",
      currency: "USD",
    });

    const { opportunity: won, project } = await lifecycleService.win(tenantId, ownerId, opportunity.id, {
      project: { code: "HRB-1" },
    });

    expect(won.status).toBe("won");
    expect(won.wonProjectId).toBe(project.id);
    expect(project.name).toBe("Harbor Tower");
    expect(project.code).toBe("HRB-1");
    expect(project.contractValueAmount).toBe("1500000.00");
    expect(project.clientContactCompanyId).toBe(company.id);
  });

  it("rejects winning or losing an opportunity that isn't open", async () => {
    const { tenantId, ownerId } = await signUpCompany("not-open");
    const stage = await pipelineStagesService.create(tenantId, ownerId, { name: "Lead", displayOrder: 1 });
    const opportunity = await opportunitiesService.create(tenantId, ownerId, {
      name: "Dead Deal",
      stageId: stage.id,
      expectedValueAmount: "10000.00",
    });
    await lifecycleService.lose(tenantId, ownerId, opportunity.id, { lostReason: "Went with a competitor" });

    await expect(
      lifecycleService.win(tenantId, ownerId, opportunity.id, { project: { code: "DEAD-1" } }),
    ).rejects.toThrow(/not open/);
    await expect(
      lifecycleService.lose(tenantId, ownerId, opportunity.id, { lostReason: "Again" }),
    ).rejects.toThrow(/not open/);
  });

  it("loses an opportunity with a reason", async () => {
    const { tenantId, ownerId } = await signUpCompany("lose");
    const stage = await pipelineStagesService.create(tenantId, ownerId, { name: "Lead", displayOrder: 1 });
    const opportunity = await opportunitiesService.create(tenantId, ownerId, {
      name: "Lost Cause",
      stageId: stage.id,
      expectedValueAmount: "5000.00",
    });

    const lost = await lifecycleService.lose(tenantId, ownerId, opportunity.id, { lostReason: "Budget cut" });
    expect(lost.status).toBe("lost");
    expect(lost.lostReason).toBe("Budget cut");
  });

  it("logs and lists activities against an opportunity's timeline", async () => {
    const { tenantId, ownerId } = await signUpCompany("activities");
    const stage = await pipelineStagesService.create(tenantId, ownerId, { name: "Lead", displayOrder: 1 });
    const opportunity = await opportunitiesService.create(tenantId, ownerId, {
      name: "Timeline Test",
      stageId: stage.id,
      expectedValueAmount: "1000.00",
    });

    await activitiesService.createForOpportunity(tenantId, ownerId, opportunity.id, {
      kind: "call",
      subject: "Intro call",
      body: "Discussed scope and timeline.",
    });
    await activitiesService.createForOpportunity(tenantId, ownerId, opportunity.id, {
      kind: "note",
      body: "Sent follow-up proposal.",
    });

    const timeline = await activitiesService.listForOpportunity(tenantId, opportunity.id);
    expect(timeline).toHaveLength(2);
    expect(timeline.map((a) => a.kind).sort()).toEqual(["call", "note"]);
  });

  it("opportunity.won.v1 produces an audit_log row keyed to crm.opportunity.win", async () => {
    const { tenantId, ownerId } = await signUpCompany("audit");
    const stage = await pipelineStagesService.create(tenantId, ownerId, { name: "Lead", displayOrder: 1 });
    const opportunity = await opportunitiesService.create(tenantId, ownerId, {
      name: "Audit Test",
      stageId: stage.id,
      expectedValueAmount: "20000.00",
    });
    await lifecycleService.win(tenantId, ownerId, opportunity.id, { project: { code: "AUD-1" } });

    const envelope = await replayLatestOutboxEvent(tenantId, "opportunity.won.v1");
    await auditWriterService.handleEnvelope(envelope);

    const auditRow = await withTenant(db, tenantId, (tx) =>
      tx.query.auditLog.findFirst({ where: (a, { and, eq: eqOp }) => and(eqOp(a.tenantId, tenantId), eqOp(a.action, "crm.opportunity.win")) }),
    );
    expect(auditRow).toBeDefined();
    expect(auditRow!.entityId).toBe(opportunity.id);
  });

  it("RLS: a tenant only sees its own contacts and opportunities", async () => {
    const a = await signUpCompany("rls-a");
    const b = await signUpCompany("rls-b");
    await contactsService.create(a.tenantId, a.ownerId, { firstName: "A", lastName: "Owner" });
    const stage = await pipelineStagesService.create(a.tenantId, a.ownerId, { name: "Lead", displayOrder: 1 });
    await opportunitiesService.create(a.tenantId, a.ownerId, { name: "A Deal", stageId: stage.id, expectedValueAmount: "1.00" });

    const bContacts = await withTenant(db, b.tenantId, (tx) => tx.query.contacts.findMany({ where: eq(contacts.tenantId, b.tenantId) }));
    expect(bContacts).toHaveLength(0);
    const bOpportunities = await withTenant(db, b.tenantId, (tx) =>
      tx.query.opportunities.findMany({ where: eq(opportunities.tenantId, b.tenantId) }),
    );
    expect(bOpportunities).toHaveLength(0);
  });
});
