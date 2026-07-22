import { randomUUID } from "node:crypto";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { notifications } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestNotificationsServices } from "./setup/notifications";
import { buildTestRbacServices } from "./setup/rbac";

describe("Notifications", () => {
  const db = getTestDatabase();
  const { authService } = buildTestAuthService(db);
  const { rbacService, redis } = buildTestRbacServices(db);
  const { notificationsService, dispatchService } = buildTestNotificationsServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return authService.signUp({
      email: `notif-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Notif ${label} ${suffix}`,
    });
  }

  function roleAssignedEnvelope(tenantId: string, userId: string, roleId: string): OutboxEnvelope {
    return {
      id: randomUUID(),
      tenantId,
      eventType: "role.assigned.v1",
      payload: { companyId: tenantId, userId, roleId, scopeType: "company" },
      dedupeKey: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
  }

  it("dispatches a role.assigned.v1 event into an in-app notification row", async () => {
    const signUp = await signUpCompany("dispatch");
    const role = await rbacService.createRole(signUp.companyId, "Viewer");

    await dispatchService.handleEnvelope(
      roleAssignedEnvelope(signUp.companyId, decodeSub(signUp.accessToken), role.id),
    );

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.notifications.findMany({ where: eq(notifications.tenantId, signUp.companyId) }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("role_assigned");
    expect(rows[0]?.readAt).toBeNull();
    const channelState = rows[0]?.channelState as Record<string, { status: string }>;
    expect(channelState.in_app?.status).toBe("sent");
    expect(channelState.email?.status).toBe("sent");
    expect(channelState.push?.status).toBe("skipped");
  });

  it("ignores event types with no notification mapping (e.g. company.registered.v1)", async () => {
    const signUp = await signUpCompany("unmapped");

    await dispatchService.handleEnvelope({
      id: randomUUID(),
      tenantId: signUp.companyId,
      eventType: "company.registered.v1",
      payload: {
        companyId: signUp.companyId,
        companyName: "x",
        ownerUserId: decodeSub(signUp.accessToken),
      },
      dedupeKey: randomUUID(),
      occurredAt: new Date().toISOString(),
    });

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.notifications.findMany({ where: eq(notifications.tenantId, signUp.companyId) }),
    );
    expect(rows).toHaveLength(0);
  });

  it("a disabled in_app preference is recorded as skipped but the row is still created", async () => {
    const signUp = await signUpCompany("pref-disabled");
    const role = await rbacService.createRole(signUp.companyId, "Viewer");
    const userId = decodeSub(signUp.accessToken);

    await notificationsService.replacePreferences(signUp.companyId, userId, [
      { category: "role.assigned", channel: "in_app", enabled: false, digest: "instant" },
    ]);

    await dispatchService.handleEnvelope(roleAssignedEnvelope(signUp.companyId, userId, role.id));

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.notifications.findMany({ where: eq(notifications.tenantId, signUp.companyId) }),
    );
    expect(rows).toHaveLength(1);
    const channelState = rows[0]?.channelState as Record<
      string,
      { status: string; reason?: string }
    >;
    expect(channelState.in_app).toEqual({ status: "skipped", reason: "preference_disabled" });
  });

  it("list filters by unread and markRead clears it", async () => {
    const signUp = await signUpCompany("list");
    const role = await rbacService.createRole(signUp.companyId, "Viewer");
    const userId = decodeSub(signUp.accessToken);

    await dispatchService.handleEnvelope(roleAssignedEnvelope(signUp.companyId, userId, role.id));

    const unreadBefore = await notificationsService.list(signUp.companyId, userId, {
      unread: true,
      limit: 20,
    });
    expect(unreadBefore.data).toHaveLength(1);

    await notificationsService.markRead(signUp.companyId, userId, {
      ids: [unreadBefore.data[0]!.id],
    });

    const unreadAfter = await notificationsService.list(signUp.companyId, userId, {
      unread: true,
      limit: 20,
    });
    expect(unreadAfter.data).toHaveLength(0);
  });

  it("registerDevice upserts on (tenantId, pushToken)", async () => {
    const signUp = await signUpCompany("device");
    const userId = decodeSub(signUp.accessToken);
    const pushToken = `token-${randomUUID()}`;

    await notificationsService.registerDevice(signUp.companyId, userId, {
      platform: "ios",
      pushToken,
      deviceName: "iPhone",
    });
    await notificationsService.registerDevice(signUp.companyId, userId, {
      platform: "android",
      pushToken,
      deviceName: "Pixel",
    });

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.pushDevices.findMany({
        where: (d) => and(eq(d.tenantId, signUp.companyId), eq(d.pushToken, pushToken)),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.platform).toBe("android");
  });

  it("RLS: a tenant only sees its own notifications", async () => {
    const companyA = await signUpCompany("rls-a");
    const companyB = await signUpCompany("rls-b");
    const roleA = await rbacService.createRole(companyA.companyId, "Viewer");
    const roleB = await rbacService.createRole(companyB.companyId, "Viewer");

    await dispatchService.handleEnvelope(
      roleAssignedEnvelope(companyA.companyId, decodeSub(companyA.accessToken), roleA.id),
    );
    await dispatchService.handleEnvelope(
      roleAssignedEnvelope(companyB.companyId, decodeSub(companyB.accessToken), roleB.id),
    );

    const rowsA = await withTenant(db, companyA.companyId, (tx) =>
      tx.query.notifications.findMany(),
    );
    expect(rowsA.every((r) => r.tenantId === companyA.companyId)).toBe(true);
    expect(rowsA.some((r) => r.tenantId === companyB.companyId)).toBe(false);
  });
});

function decodeSub(jwt: string): string {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
  return payload.sub;
}
