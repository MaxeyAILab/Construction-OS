import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { and, arrayContains, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { webhookDeliveries, webhookEndpoints } from "../../../infrastructure/db/schema";
import { EncryptionService } from "../../auth";
import { OutboxService } from "../../events";
import { signPayload } from "../domain/signing";

type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;

export interface DeliveryResult {
  endpointId: string;
  ok: boolean;
  responseStatus: string;
}

// api.md §16.3: "Delivery: HMAC-SHA256 signature header ... at-least-once,
// exponential retries 24 h -> dead-letter + notification." This service owns
// the *delivery mechanics* only (sign, POST, log, dead-letter-on-final-
// attempt) — retry/backoff scheduling is WebhookDispatchConsumerWorker's job
// (mirrors AuditConsumerWorker's own split between "handle one envelope" and
// "the NATS ack/nak loop around it"), and WebhooksService.test() calls
// deliverToEndpoint directly to bypass NATS entirely, same "test the runner
// directly" precedent as ProjectAssistantService/DashboardsService tests.
@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly encryption: EncryptionService,
  ) {}

  // Finds every active endpoint in the envelope's tenant subscribed to this
  // event type and delivers to each. One NATS message can therefore fan out
  // to N endpoints; JetStream redelivery is whole-message, so a retry
  // triggered by one endpoint's failure may re-deliver (harmlessly, since
  // consumers must be idempotent per architecture.md §8) to an
  // already-succeeded endpoint.
  async dispatchEnvelope(envelope: OutboxEnvelope, opts: { isFinalAttempt: boolean }): Promise<DeliveryResult[]> {
    const endpoints = await withTenant(this.db, envelope.tenantId, (tx) =>
      tx.query.webhookEndpoints.findMany({
        where: and(
          eq(webhookEndpoints.tenantId, envelope.tenantId),
          eq(webhookEndpoints.isActive, true),
          isNull(webhookEndpoints.deletedAt),
          arrayContains(webhookEndpoints.subscribedEvents, [envelope.eventType]),
        ),
      }),
    );

    const results: DeliveryResult[] = [];
    for (const endpoint of endpoints) {
      results.push(await this.deliverToEndpoint(endpoint, envelope.eventType, envelope.payload, opts.isFinalAttempt));
    }
    return results;
  }

  // Shared by the real dispatch path above and WebhooksService.test() (a
  // synthetic, always-final-attempt delivery — a manual test has nothing to
  // retry).
  async deliverToEndpoint(
    endpoint: WebhookEndpointRow,
    eventType: string,
    payload: unknown,
    isFinalAttempt: boolean,
  ): Promise<DeliveryResult> {
    const secret = this.encryption.decrypt(endpoint.secret);
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ eventType, payload });
    const signature = signPayload(secret, timestamp, body);

    let responseStatus: string;
    let ok: boolean;
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-COS-Signature": signature,
          "X-COS-Timestamp": String(timestamp),
        },
        body,
      });
      responseStatus = String(response.status);
      ok = response.ok;
    } catch (err) {
      responseStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
      ok = false;
    }

    await withTenant(this.db, endpoint.tenantId, (tx) =>
      tx.insert(webhookDeliveries).values({
        tenantId: endpoint.tenantId,
        webhookEndpointId: endpoint.id,
        eventType,
        payload,
        responseStatus,
      }),
    );

    if (!ok && isFinalAttempt) {
      await withTenant(this.db, endpoint.tenantId, (tx) =>
        this.outbox.append(tx, {
          tenantId: endpoint.tenantId,
          eventType: "webhook_delivery.dead_lettered.v1",
          dedupeKey: `webhook_delivery.dead_lettered.v1:${endpoint.id}:${eventType}:${Date.now()}`,
          actorId: null,
          payload: {
            companyId: endpoint.tenantId,
            webhookEndpointId: endpoint.id,
            eventType,
            createdBy: endpoint.createdBy,
          },
        }),
      );
      this.logger.error(`webhook delivery to ${endpoint.url} dead-lettered after final attempt (${responseStatus})`);
    }

    return { endpointId: endpoint.id, ok, responseStatus };
  }
}
