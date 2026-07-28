import { createServer, type Server } from "node:http";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webhookEndpoints } from "../src/infrastructure/db/schema";
import { withTenant } from "../src/infrastructure/db/client";
import { signPayload } from "../src/modules/webhooks/domain/signing";
import { draftNotifications } from "../src/modules/notifications/domain/event-notification-map";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestWebhookServices } from "./setup/webhooks";

interface CapturedRequest {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

// Real local HTTP server, not a fake provider — unlike Accounting (which
// needs a FakeAccountingProvider because it can't stand up a QuickBooks
// sandbox in CI), Webhooks controls both sides of the delivery HTTP call,
// so end-to-end signature verification is possible with no external
// dependency.
function startCapturingServer(responseStatus = 200): Promise<{
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const requests: CapturedRequest[] = [];
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(responseStatus);
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

// api.md §16.3: "GET/POST/PATCH/DELETE /webhooks | Endpoint CRUD ... GET
// /webhooks/{id}/deliveries ... POST /webhooks/{id}/test." Delivery is
// HMAC-SHA256 signed, timestamped, at-least-once, with exponential retry to
// dead-letter + notification (FR-PLAT-8 platform track).
describe("Webhooks (outbound event delivery)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { webhooksService, dispatchService } = buildTestWebhookServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `webhook-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Webhook ${label} ${suffix}`,
    });
    const payload = JSON.parse(Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString());
    return { tenantId: signUp.companyId, ownerId: payload.sub as string };
  }

  it("creates an endpoint, never returns the secret, and delivers a verifiably-signed test event", async () => {
    const { tenantId, ownerId } = await signUpCompany("crud");
    const server = await startCapturingServer(200);
    try {
      const secret = "a-shared-secret-1234567890";
      const created = await webhooksService.create(tenantId, ownerId, {
        url: server.url,
        secret,
        subscribedEvents: ["project.created.v1"],
      });
      expect(created).not.toHaveProperty("secret");

      const listed = await webhooksService.list(tenantId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).not.toHaveProperty("secret");

      const result = await webhooksService.test(tenantId, created.id);
      expect(result.ok).toBe(true);
      expect(result.responseStatus).toBe("200");

      expect(server.requests).toHaveLength(1);
      const request = server.requests[0]!;
      const timestamp = request.headers["x-cos-timestamp"] as string;
      const signature = request.headers["x-cos-signature"] as string;
      expect(timestamp).toBeTruthy();
      expect(signature).toBe(signPayload(secret, Number(timestamp), request.body));

      const deliveries = await webhooksService.listDeliveries(tenantId, created.id, { limit: 20 });
      expect(deliveries.data).toHaveLength(1);
      expect(deliveries.data[0]!.eventType).toBe("webhook.test.v1");
      expect(deliveries.data[0]!.responseStatus).toBe("200");
    } finally {
      await server.close();
    }
  });

  it("updates fields (re-encrypting a rotated secret) and stops delivering after delete", async () => {
    const { tenantId, ownerId } = await signUpCompany("update");
    const serverA = await startCapturingServer(200);
    const serverB = await startCapturingServer(200);
    try {
      const created = await webhooksService.create(tenantId, ownerId, {
        url: serverA.url,
        secret: "original-secret-1234567890",
        subscribedEvents: ["project.created.v1"],
      });

      const updated = await webhooksService.update(tenantId, ownerId, created.id, {
        url: serverB.url,
        secret: "rotated-secret-1234567890",
      });
      expect(updated).not.toHaveProperty("secret");
      expect(updated.url).toBe(serverB.url);

      const testResult = await webhooksService.test(tenantId, updated.id);
      expect(testResult.ok).toBe(true);
      expect(serverA.requests).toHaveLength(0);
      expect(serverB.requests).toHaveLength(1);
      const signature = serverB.requests[0]!.headers["x-cos-signature"] as string;
      const timestamp = serverB.requests[0]!.headers["x-cos-timestamp"] as string;
      expect(signature).toBe(signPayload("rotated-secret-1234567890", Number(timestamp), serverB.requests[0]!.body));

      await webhooksService.delete(tenantId, ownerId, created.id);
      await expect(webhooksService.test(tenantId, created.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
      await expect(webhooksService.list(tenantId)).resolves.toHaveLength(0);
    } finally {
      await serverA.close();
      await serverB.close();
    }
  });

  it("dispatchEnvelope fans out only to endpoints subscribed to that event type", async () => {
    const { tenantId, ownerId } = await signUpCompany("fanout");
    const subscribed = await startCapturingServer(200);
    const unsubscribed = await startCapturingServer(200);
    try {
      await webhooksService.create(tenantId, ownerId, {
        url: subscribed.url,
        secret: "subscribed-secret-1234567890",
        subscribedEvents: ["project.created.v1"],
      });
      await webhooksService.create(tenantId, ownerId, {
        url: unsubscribed.url,
        secret: "unsubscribed-secret-1234567890",
        subscribedEvents: ["file.uploaded.v1"],
      });

      const envelope: OutboxEnvelope = {
        id: crypto.randomUUID(),
        tenantId,
        eventType: "project.created.v1",
        payload: { companyId: tenantId, projectId: crypto.randomUUID() },
        dedupeKey: `test:${crypto.randomUUID()}`,
        occurredAt: new Date().toISOString(),
        actorId: ownerId,
        actorType: "user",
      };
      const results = await dispatchService.dispatchEnvelope(envelope, { isFinalAttempt: false });

      expect(results).toHaveLength(1);
      expect(results[0]!.ok).toBe(true);
      expect(subscribed.requests).toHaveLength(1);
      expect(unsubscribed.requests).toHaveLength(0);
    } finally {
      await subscribed.close();
      await unsubscribed.close();
    }
  });

  it("dead-letters a final-attempt delivery failure and emits a notification draft for the endpoint owner", async () => {
    const { tenantId, ownerId } = await signUpCompany("deadletter");
    const created = await webhooksService.create(tenantId, ownerId, {
      // Nothing listens on this port — fetch() rejects, exercising the
      // catch-and-record-failure branch of deliverToEndpoint.
      url: "http://127.0.0.1:1",
      secret: "unreachable-secret-1234567890",
      subscribedEvents: ["project.created.v1"],
    });

    const endpoint = await withTenant(db, tenantId, (tx) =>
      tx.query.webhookEndpoints.findFirst({ where: eq(webhookEndpoints.id, created.id) }),
    );
    const result = await dispatchService.deliverToEndpoint(endpoint!, "project.created.v1", { companyId: tenantId }, true);
    expect(result.ok).toBe(false);

    const deadLetterEvent = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findFirst({
        where: (o, { and, eq: eqOp }) => and(eqOp(o.tenantId, tenantId), eqOp(o.eventType, "webhook_delivery.dead_lettered.v1")),
      }),
    );
    expect(deadLetterEvent).toBeDefined();
    const eventPayload = deadLetterEvent!.payload as { webhookEndpointId: string; createdBy: string | null; eventType: string };
    expect(eventPayload.webhookEndpointId).toBe(created.id);
    expect(eventPayload.createdBy).toBe(ownerId);

    const drafts = draftNotifications({
      id: deadLetterEvent!.id,
      tenantId,
      eventType: deadLetterEvent!.eventType,
      payload: deadLetterEvent!.payload,
      dedupeKey: deadLetterEvent!.dedupeKey,
      occurredAt: deadLetterEvent!.occurredAt.toISOString(),
      actorId: deadLetterEvent!.actorId,
      actorType: deadLetterEvent!.actorType as OutboxEnvelope["actorType"],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.recipientUserId).toBe(ownerId);
    expect(drafts[0]!.kind).toBe("webhook_delivery_dead_lettered");
  });

  it("rejects an unregistered event type in subscribedEvents at the zod layer (not the service)", async () => {
    const { createWebhookEndpointSchema } = await import("@constructionos/schemas");
    const parsed = createWebhookEndpointSchema.safeParse({
      url: "https://example.test/hook",
      secret: "some-secret-1234567890",
      subscribedEvents: ["not_a_real_event.v1"],
    });
    expect(parsed.success).toBe(false);
  });
});
