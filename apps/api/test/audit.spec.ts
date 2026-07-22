import { randomUUID } from "node:crypto";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { auditLog, outbox } from "../src/infrastructure/db/schema";
import { buildTestAuditServices } from "./setup/audit";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestRbacServices } from "./setup/rbac";

describe("Audit spine", () => {
  const db = getTestDatabase();
  const { authService } = buildTestAuthService(db);
  const { rbacService, redis } = buildTestRbacServices(db);
  const { auditQueryService, auditWriterService } = buildTestAuditServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return authService.signUp({
      email: `audit-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Audit ${label} ${suffix}`,
    });
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  // Bypasses NATS entirely (same approach as notifications.spec.ts) —
  // reads the outbox rows a real service call produced, replays each as
  // an envelope directly into the writer.
  async function replayOutboxToAudit(tenantId: string): Promise<void> {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    );
    for (const row of rows) {
      const envelope: OutboxEnvelope = {
        id: row.id,
        tenantId: row.tenantId,
        eventType: row.eventType,
        payload: row.payload,
        dedupeKey: row.dedupeKey,
        occurredAt: row.occurredAt.toISOString(),
        actorId: row.actorId,
        actorType: row.actorType as OutboxEnvelope["actorType"],
      };
      await auditWriterService.handleEnvelope(envelope);
    }
  }

  it("a full RBAC lifecycle produces one correctly-attributed audit row per privileged action", async () => {
    const signUp = await signUpCompany("lifecycle");
    const ownerId = decodeSub(signUp.accessToken);

    const role = await rbacService.createRole(signUp.companyId, "Estimator", ownerId);
    await rbacService.grantPermissionToRole(
      signUp.companyId,
      role.id,
      "platform.role.read",
      ownerId,
    );
    await rbacService.revokePermissionFromRole(
      signUp.companyId,
      role.id,
      "platform.role.read",
      ownerId,
    );
    const invited = await rbacService.inviteUser(
      signUp.companyId,
      `audit-invitee-${Date.now()}@example.com`,
      "Invitee",
      ownerId,
    );
    await rbacService.assignRole(
      signUp.companyId,
      invited.userId,
      role.id,
      { scopeType: "company" },
      ownerId,
    );
    await rbacService.revokeRole(signUp.companyId, invited.userId, role.id, ownerId);
    await rbacService.removeUser(signUp.companyId, invited.userId, ownerId);

    await replayOutboxToAudit(signUp.companyId);

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.auditLog.findMany({ where: eq(auditLog.tenantId, signUp.companyId) }),
    );
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(
      [
        "platform.company.register",
        "platform.company_user.invite",
        "platform.company_user.remove",
        "platform.role.manage", // createRole
        "platform.role.manage", // grantPermissionToRole
        "platform.role.manage", // revokePermissionFromRole
        "platform.user_role.assign",
        "platform.user_role.revoke",
      ].sort(),
    );
    expect(rows.every((r) => r.actorId === ownerId)).toBe(true);
    expect(rows.every((r) => r.actorType === "user")).toBe(true);
  });

  it("skips events with no audit mapping instead of erroring", async () => {
    const signUp = await signUpCompany("unmapped");

    await auditWriterService.handleEnvelope({
      id: randomUUID(),
      tenantId: signUp.companyId,
      eventType: "not.a.real.event",
      payload: {},
      dedupeKey: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorId: null,
      actorType: "system",
    });

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.auditLog.findMany({ where: eq(auditLog.tenantId, signUp.companyId) }),
    );
    expect(rows).toHaveLength(0);
  });

  it("is immutable: UPDATE and DELETE are rejected even for the table-owning app role", async () => {
    const signUp = await signUpCompany("immutable");
    await replayOutboxToAudit(signUp.companyId);

    const [row] = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.auditLog.findMany({ where: eq(auditLog.tenantId, signUp.companyId) }),
    );
    expect(row).toBeDefined();

    await expect(
      withTenant(db, signUp.companyId, (tx) =>
        tx.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.id, row!.id)),
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      withTenant(db, signUp.companyId, (tx) => tx.delete(auditLog).where(eq(auditLog.id, row!.id))),
    ).rejects.toThrow(/append-only/);
  });

  it("RLS: a tenant only sees its own audit_log rows", async () => {
    const companyA = await signUpCompany("rls-a");
    const companyB = await signUpCompany("rls-b");
    await replayOutboxToAudit(companyA.companyId);
    await replayOutboxToAudit(companyB.companyId);

    const rowsA = await withTenant(db, companyA.companyId, (tx) => tx.query.auditLog.findMany());
    expect(rowsA.every((r) => r.tenantId === companyA.companyId)).toBe(true);
    expect(rowsA.some((r) => r.tenantId === companyB.companyId)).toBe(false);
  });

  it("AuditQueryService filters by actor/action and paginates", async () => {
    const signUp = await signUpCompany("filters");
    const ownerId = decodeSub(signUp.accessToken);
    const role = await rbacService.createRole(signUp.companyId, "Viewer", ownerId);
    await rbacService.grantPermissionToRole(
      signUp.companyId,
      role.id,
      "platform.role.read",
      ownerId,
    );
    await replayOutboxToAudit(signUp.companyId);

    const byAction = await auditQueryService.list(signUp.companyId, {
      action: "platform.role.manage",
      limit: 20,
    });
    expect(byAction.data).toHaveLength(2); // createRole + grantPermissionToRole
    expect(byAction.data.every((r) => r.actorId === ownerId)).toBe(true);

    const byActor = await auditQueryService.list(signUp.companyId, {
      actorId: ownerId,
      limit: 20,
    });
    expect(byActor.data.length).toBeGreaterThanOrEqual(3);

    const firstPage = await auditQueryService.list(signUp.companyId, { limit: 1 });
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.meta.hasMore).toBe(true);
    expect(firstPage.meta.cursor).not.toBeNull();

    const secondPage = await auditQueryService.list(signUp.companyId, {
      limit: 1,
      cursor: firstPage.meta.cursor!,
    });
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.data[0]!.id).not.toBe(firstPage.data[0]!.id);
  });
});
