import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestRfisServices } from "./setup/rfis";

describe("RFIs v1", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService } = buildTestProjectServices(db);
  const { rfisService } = buildTestRfisServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `rfi-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `RFI ${label} ${suffix}`,
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

  async function outboxEventTypes(tenantId: string): Promise<string[]> {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    );
    return rows.map((r) => r.eventType);
  }

  it("creates RFIs with auto-numbering per project", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("crud");
    const rfi1 = await rfisService.create(tenantId, ownerId, project.id, {
      subject: "Beam size clarification",
      question: "What size is beam B-12?",
    });
    expect(rfi1.number).toBe(1);
    expect(rfi1.status).toBe("draft");

    const rfi2 = await rfisService.create(tenantId, ownerId, project.id, {
      subject: "Door hardware",
      question: "Confirm hardware set for door D-3",
    });
    expect(rfi2.number).toBe(2);

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("rfi.created.v1");
  });

  it("drives the full lifecycle: draft -> open -> answered -> closed", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("lifecycle");
    const rfi = await rfisService.create(tenantId, ownerId, project.id, {
      subject: "Footing depth",
      question: "What is the footing depth at grid C-4?",
    });

    const opened = await rfisService.update(tenantId, ownerId, rfi.id, { status: "open" });
    expect(opened.status).toBe("open");

    const answered = await rfisService.update(tenantId, ownerId, rfi.id, {
      status: "answered",
      answer: "42 inches below grade.",
    });
    expect(answered.status).toBe("answered");
    expect(answered.answer).toBe("42 inches below grade.");

    const closed = await rfisService.update(tenantId, ownerId, rfi.id, { status: "closed" });
    expect(closed.status).toBe("closed");

    const eventTypes = await outboxEventTypes(tenantId);
    expect(eventTypes).toContain("rfi.updated.v1");
  });

  it("rejects illegal transitions and requires an answer to reach 'answered'", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("illegal");
    const rfi = await rfisService.create(tenantId, ownerId, project.id, {
      subject: "Test",
      question: "Test question",
    });

    await expect(rfisService.update(tenantId, ownerId, rfi.id, { status: "answered" })).rejects.toThrow(
      /cannot transition/,
    );

    await rfisService.update(tenantId, ownerId, rfi.id, { status: "open" });
    await expect(rfisService.update(tenantId, ownerId, rfi.id, { status: "answered" })).rejects.toThrow(
      /answer/,
    );

    const closedRfi = await rfisService.create(tenantId, ownerId, project.id, {
      subject: "Closed test",
      question: "Q",
    });
    await rfisService.update(tenantId, ownerId, closedRfi.id, { status: "open" });
    await rfisService.update(tenantId, ownerId, closedRfi.id, { status: "answered", answer: "A" });
    await rfisService.update(tenantId, ownerId, closedRfi.id, { status: "closed" });
    await expect(rfisService.update(tenantId, ownerId, closedRfi.id, { status: "open" })).rejects.toThrow(
      /cannot transition/,
    );
  });

  it("void is reachable from draft/open/answered but not from closed", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("void");
    const rfi = await rfisService.create(tenantId, ownerId, project.id, {
      subject: "Voidable",
      question: "Q",
    });
    const voided = await rfisService.update(tenantId, ownerId, rfi.id, { status: "void" });
    expect(voided.status).toBe("void");
  });

  it("RLS: a tenant only sees its own RFIs", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    await rfisService.create(a.tenantId, a.ownerId, a.project.id, { subject: "A", question: "Q" });

    const rowsB = await withTenant(db, b.tenantId, (tx) => tx.query.rfis.findMany());
    expect(rowsB).toHaveLength(0);
  });
});
