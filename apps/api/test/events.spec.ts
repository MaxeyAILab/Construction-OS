import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Subscription } from "nats";
import { StringCodec } from "nats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { outbox } from "../src/infrastructure/db/schema";
import { eventSubject } from "../src/infrastructure/nats/client";
import {
  InvalidEventPayloadError,
  UnknownEventTypeError,
} from "../src/modules/events/domain/errors";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestEventsServices } from "./setup/events";
import { buildTestRbacServices } from "./setup/rbac";

type DecodedEnvelope = {
  id: string;
  tenantId: string;
  eventType: string;
  payload: unknown;
  dedupeKey: string;
  occurredAt: string;
};

function waitForEnvelope(
  sub: Subscription,
  predicate: (env: DecodedEnvelope) => boolean,
  timeoutMs = 5000,
): Promise<DecodedEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for NATS message")),
      timeoutMs,
    );
    void (async () => {
      for await (const msg of sub) {
        const decoded = JSON.parse(new TextDecoder().decode(msg.data)) as DecodedEnvelope;
        if (predicate(decoded)) {
          clearTimeout(timer);
          sub.unsubscribe();
          resolve(decoded);
          return;
        }
      }
    })();
  });
}

describe("Events backbone", () => {
  const db = getTestDatabase();
  const { authService } = buildTestAuthService(db);
  const { rbacService, redis } = buildTestRbacServices(db);
  let events: Awaited<ReturnType<typeof buildTestEventsServices>>;

  beforeAll(async () => {
    await bootstrapTestRole();
    events = await buildTestEventsServices(db);
  });

  afterAll(async () => {
    await redis.quit();
    await events.nc.close();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return authService.signUp({
      email: `events-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Events ${label} ${suffix}`,
    });
  }

  it("signUp appends a company.registered.v1 outbox row in the same transaction", async () => {
    const signUp = await signUpCompany("signup");

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, signUp.companyId) }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe("company.registered.v1");
    expect(rows[0]?.payload).toMatchObject({ companyId: signUp.companyId });
    expect(rows[0]?.publishedAt).toBeNull();
  });

  it("inviteUser and assignRole append user.invited.v1 / role.assigned.v1 outbox rows", async () => {
    const signUp = await signUpCompany("rbac");
    const ownerId = decodeSub(signUp.accessToken);
    const role = await rbacService.createRole(signUp.companyId, "Field Crew", ownerId);

    const invited = await rbacService.inviteUser(
      signUp.companyId,
      `events-invitee-${Date.now()}@example.com`,
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

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, signUp.companyId) }),
    );
    const eventTypes = rows.map((r) => r.eventType).sort();
    expect(eventTypes).toEqual([
      "company.registered.v1",
      "role.assigned.v1",
      "role.created.v1",
      "user.invited.v1",
    ]);
    expect(rows.every((r) => r.actorId === ownerId)).toBe(true);
  });

  it("rejects appending an unknown event type", async () => {
    const signUp = await signUpCompany("unknown-type");
    await withTenant(db, signUp.companyId, async (tx) => {
      await expect(
        events.outboxService.append(tx, {
          tenantId: signUp.companyId,
          // @ts-expect-error deliberately invalid for the test
          eventType: "not.a.real.event",
          payload: {},
          dedupeKey: randomUUID(),
          actorId: null,
        }),
      ).rejects.toThrow(UnknownEventTypeError);
    });
  });

  it("rejects an invalid payload for a known event type", async () => {
    const signUp = await signUpCompany("bad-payload");
    await withTenant(db, signUp.companyId, async (tx) => {
      await expect(
        events.outboxService.append(tx, {
          tenantId: signUp.companyId,
          eventType: "user.invited.v1",
          payload: { companyId: signUp.companyId }, // missing userId/email
          dedupeKey: randomUUID(),
          actorId: null,
        }),
      ).rejects.toThrow(InvalidEventPayloadError);
    });
  });

  it("outbox_claim_pending_events reclaims a row whose lease expired without being published", async () => {
    await signUpCompany("reclaim");

    const first = Array.from(
      await db.execute<{ id: string }>(sql`select id from outbox_claim_pending_events(10, 0)`),
    )[0];
    expect(first).toBeDefined();

    // p_lease_seconds = 0: the lease is already expired by the time the
    // second call runs, so the same row (still unpublished) is reclaimable.
    const second = Array.from(
      await db.execute<{ id: string }>(sql`select id from outbox_claim_pending_events(10, 0)`),
    );
    const reclaimed = second.some((row) => row.id === first!.id);
    expect(reclaimed).toBe(true);

    // Mark it published so it doesn't leak into later tests in this file
    // that assert exact outbox contents.
    await db.execute(sql`select outbox_mark_published(array[${first!.id}]::uuid[])`);
  });

  it("relayBatch publishes claimed events to NATS JetStream and marks them published", async () => {
    const signUp = await signUpCompany("relay");
    const sub = events.nc.subscribe(eventSubject("company.registered.v1"));
    const found = waitForEnvelope(sub, (env) => env.tenantId === signUp.companyId);

    const result = await events.relayService.relayBatch(200);
    expect(result.published).toBeGreaterThanOrEqual(1);

    const envelope = await found;
    expect(envelope.eventType).toBe("company.registered.v1");
    expect(envelope.payload).toMatchObject({ companyId: signUp.companyId });

    const rows = await withTenant(db, signUp.companyId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, signUp.companyId) }),
    );
    expect(rows[0]?.publishedAt).not.toBeNull();
  });

  it("NATS rejects a republished message carrying an already-used dedupe key as a duplicate", async () => {
    const jetstream = events.nc.jetstream();
    const sc = StringCodec();
    const dedupeKey = randomUUID();
    const subject = eventSubject("test.dedupe.v1");

    const first = await jetstream.publish(subject, sc.encode("payload"), { msgID: dedupeKey });
    const second = await jetstream.publish(subject, sc.encode("payload"), { msgID: dedupeKey });

    expect(first.duplicate).toBeFalsy();
    expect(second.duplicate).toBe(true);
  });

  it("RLS: a tenant-scoped query only sees its own outbox rows, but the relay's claim function sees across tenants", async () => {
    const companyA = await signUpCompany("rls-a");
    const companyB = await signUpCompany("rls-b");

    const rowsSeenByA = await withTenant(db, companyA.companyId, (tx) =>
      tx.query.outbox.findMany(),
    );
    expect(rowsSeenByA.every((r) => r.tenantId === companyA.companyId)).toBe(true);
    expect(rowsSeenByA.some((r) => r.tenantId === companyB.companyId)).toBe(false);

    // Production's relay only ever claims in small batches (relayBatch's
    // default is 50) — this test uses a much larger limit purely so the
    // assertion doesn't depend on where these two brand-new rows land
    // among whatever backlog happens to exist in the shared local sandbox
    // Postgres (claim order is occurred_at ASC, oldest first).
    const claimed = Array.from(
      await db.execute<{ tenant_id: string }>(
        sql`select tenant_id from outbox_claim_pending_events(100000, 0)`,
      ),
    );
    const tenantIds = new Set(claimed.map((r) => r.tenant_id));
    expect(tenantIds.has(companyA.companyId)).toBe(true);
    expect(tenantIds.has(companyB.companyId)).toBe(true);
  });
});

function decodeSub(jwt: string): string {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
  return payload.sub;
}
