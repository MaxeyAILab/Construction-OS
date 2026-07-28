import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox, rolePermissions, roles } from "../src/infrastructure/db/schema";
import { buildTestAgentIdentitiesService, buildTestComplianceAgentRunner } from "./setup/agents";
import { buildTestAuthService } from "./setup/auth";
import { buildTestComplianceAlertsServices } from "./setup/compliance-alerts";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestSubcontractorServices } from "./setup/subcontractors";

// api.md §15.4 "Compliance Agent" (ai-spec.md §15). The daily tick
// (ComplianceAgentRunnerService.runTick, tested directly here rather than
// through ComplianceAgentWorker's BullMQ scheduling) reuses
// CertificationsService's existing due-state computation unchanged and
// composes it with ComplianceAlertsService.raiseIfNew under a declared
// agent's own actor. These tests cover the new composition: subcontractor-
// only scoping, dedupe across ticks, actor_type='ai' attribution, and
// kill-switch integration — not CertificationsService's own due-state math
// (see certifications tests in safety.spec.ts for that).
describe("Compliance Agent: daily tick (chase expiring subcontractor compliance)", () => {
  const db = getTestDatabase();
  const { authService, redis: authRedis } = buildTestAuthService(db);
  const { certificationsService, subcontractorsService } = buildTestSubcontractorServices(db);
  const { complianceAlertsService, complianceAlertsQueryService } = buildTestComplianceAlertsServices(db);
  const { agents, redis: agentsRedis } = buildTestAgentIdentitiesService(db);
  const runner = buildTestComplianceAgentRunner(db, agents, certificationsService, complianceAlertsService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await authRedis.quit();
    await agentsRedis.quit();
  });

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `compliance-agent-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `ComplianceAgent ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    return { tenantId: signUp.companyId, ownerId };
  }

  // The agent's role needs safety.certification.read — the same
  // permission a human calling GET /compliance/alerts (which reuses it)
  // would need.
  async function createAgentRole(tenantId: string, ownerId: string, name: string) {
    return withTenant(db, tenantId, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId, name, createdBy: ownerId }).returning();
      await tx.insert(rolePermissions).values([{ tenantId, roleId: role!.id, permissionKey: "safety.certification.read" }]);
      return role!;
    });
  }

  function daysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function outboxRowsFor(tenantId: string, eventType: string) {
    return withTenant(db, tenantId, (tx) => tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) })).then(
      (rows) => rows.filter((r) => r.eventType === eventType),
    );
  }

  it("raises an alert for an expiring subcontractor certification, attributed to the agent as actor_type='ai'", async () => {
    const { tenantId, ownerId } = await signUpCompany("happy");
    const subcontractor = await subcontractorsService.create(tenantId, ownerId, { name: "Happy Electric" });
    const cert = await certificationsService.create(tenantId, ownerId, {
      holderSubcontractorId: subcontractor.id,
      holderName: "Happy Electric",
      certType: "general_liability_insurance",
      issuedAt: daysFromNow(-300),
      expiresAt: daysFromNow(10), // within the 30-day expiring_soon window
    });

    const role = await createAgentRole(tenantId, ownerId, "Compliance Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Compliance Agent",
      purpose: "Chases expiring subcontractor certs/insurance.",
      roleId: role.id,
      toolAllowlist: ["chase_expiring_subcontractor_compliance"],
    });

    await runner.runTick();

    const alerts = await complianceAlertsQueryService.list(tenantId, { limit: 20 });
    const raised = alerts.data.find((a) => a.certificationId === cert.id);
    expect(raised).toBeDefined();
    expect(raised!.dueState).toBe("expiring_soon");
    expect(raised!.subcontractorId).toBe(subcontractor.id);

    const events = await outboxRowsFor(tenantId, "compliance_alert.raised.v1");
    const event = events.find((e) => (e.payload as { certificationId: string }).certificationId === cert.id);
    expect(event?.actorId).toBe(agent.userId);
    expect(event?.actorType).toBe("ai");
  });

  it("does not re-raise the same (certification, due_state) pair on a second tick", async () => {
    const { tenantId, ownerId } = await signUpCompany("dedupe");
    const subcontractor = await subcontractorsService.create(tenantId, ownerId, { name: "Dedupe Plumbing" });
    await certificationsService.create(tenantId, ownerId, {
      holderSubcontractorId: subcontractor.id,
      holderName: "Dedupe Plumbing",
      certType: "workers_comp_insurance",
      issuedAt: daysFromNow(-300),
      expiresAt: daysFromNow(-1), // already expired
    });

    const role = await createAgentRole(tenantId, ownerId, "Compliance Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Compliance Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["chase_expiring_subcontractor_compliance"],
    });

    await runner.runTick();
    await runner.runTick();

    const alerts = await complianceAlertsQueryService.list(tenantId, { subcontractorId: subcontractor.id, limit: 20 });
    expect(alerts.data).toHaveLength(1);
    expect(alerts.data[0]!.dueState).toBe("expired");
  });

  it("ignores a user-held certification (no holder_subcontractor_id) — Safety's own concern, not chased here", async () => {
    const { tenantId, ownerId } = await signUpCompany("userheld");
    const cert = await certificationsService.create(tenantId, ownerId, {
      holderUserId: ownerId,
      holderName: "Owner",
      certType: "osha_10",
      issuedAt: daysFromNow(-300),
      expiresAt: daysFromNow(5),
    });

    const role = await createAgentRole(tenantId, ownerId, "Compliance Watcher");
    await agents.create(tenantId, ownerId, {
      name: "Compliance Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["chase_expiring_subcontractor_compliance"],
    });

    await runner.runTick();

    const alerts = await complianceAlertsQueryService.list(tenantId, { limit: 20 });
    expect(alerts.data.find((a) => a.certificationId === cert.id)).toBeUndefined();
  });

  it("skips a paused agent (kill-switch) without erroring the whole tick", async () => {
    const { tenantId, ownerId } = await signUpCompany("paused");
    const subcontractor = await subcontractorsService.create(tenantId, ownerId, { name: "Paused Roofing" });
    const cert = await certificationsService.create(tenantId, ownerId, {
      holderSubcontractorId: subcontractor.id,
      holderName: "Paused Roofing",
      certType: "general_liability_insurance",
      issuedAt: daysFromNow(-300),
      expiresAt: daysFromNow(5),
    });

    const role = await createAgentRole(tenantId, ownerId, "Compliance Watcher");
    const agent = await agents.create(tenantId, ownerId, {
      name: "Compliance Agent",
      purpose: "x",
      roleId: role.id,
      toolAllowlist: ["chase_expiring_subcontractor_compliance"],
    });
    await agents.pause(tenantId, ownerId, agent.id);

    await expect(runner.runTick()).resolves.toBeUndefined();

    const alerts = await complianceAlertsQueryService.list(tenantId, { limit: 20 });
    expect(alerts.data.find((a) => a.certificationId === cert.id)).toBeUndefined();
  });
});
