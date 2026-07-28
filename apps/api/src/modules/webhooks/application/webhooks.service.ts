import { Inject, Injectable } from "@nestjs/common";
import type { CreateWebhookEndpointInput, ListWebhookDeliveriesQuery, UpdateWebhookEndpointInput } from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { webhookDeliveries, webhookEndpoints } from "../../../infrastructure/db/schema";
import { EncryptionService } from "../../auth";
import { OutboxService } from "../../events";
import { WebhookEndpointNotFoundError } from "../domain/errors";
import { WebhookDispatchService } from "./webhook-dispatch.service";

interface Cursor {
  attemptedAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// The secret is write-only over the API (api.md §16.3): callers supply it
// on create/update but it must never be echoed back, same
// "never surface encrypted token material" precedent as
// AccountingConnectionsService.getStatus.
function omitSecret<T extends { secret: string }>(endpoint: T): Omit<T, "secret"> {
  const { secret: _secret, ...safe } = endpoint;
  return safe;
}

// api.md §16.3: "GET/POST/PATCH/DELETE /webhooks | admin.webhook.manage |
// Endpoint CRUD ... GET /webhooks/{id}/deliveries ... POST /webhooks/{id}/test."
@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly encryption: EncryptionService,
    private readonly dispatch: WebhookDispatchService,
  ) {}

  async list(tenantId: string) {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx.query.webhookEndpoints.findMany({
        where: and(eq(webhookEndpoints.tenantId, tenantId), isNull(webhookEndpoints.deletedAt)),
        orderBy: [desc(webhookEndpoints.createdAt)],
      }),
    );
    return rows.map(omitSecret);
  }

  async create(tenantId: string, actorId: string, input: CreateWebhookEndpointInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(webhookEndpoints)
        .values({
          tenantId,
          url: input.url,
          secret: this.encryption.encrypt(input.secret),
          subscribedEvents: input.subscribedEvents,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "webhook_endpoint.created.v1",
        dedupeKey: `webhook_endpoint.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, webhookEndpointId: created!.id, url: created!.url },
      });

      return omitSecret(created!);
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateWebhookEndpointInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireEndpoint(tx, tenantId, id);

      const [updated] = await tx
        .update(webhookEndpoints)
        .set({
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.secret !== undefined ? { secret: this.encryption.encrypt(input.secret) } : {}),
          ...(input.subscribedEvents !== undefined ? { subscribedEvents: input.subscribedEvents } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedBy: actorId,
        })
        .where(eq(webhookEndpoints.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "webhook_endpoint.updated.v1",
        dedupeKey: `webhook_endpoint.updated.v1:${id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, webhookEndpointId: id, changedFields: Object.keys(input) },
      });

      return omitSecret(updated!);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireEndpoint(tx, tenantId, id);

      await tx
        .update(webhookEndpoints)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(webhookEndpoints.id, id));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "webhook_endpoint.deleted.v1",
        dedupeKey: `webhook_endpoint.deleted.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, webhookEndpointId: id },
      });
    });
  }

  async listDeliveries(tenantId: string, endpointId: string, query: ListWebhookDeliveriesQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireEndpoint(tx, tenantId, endpointId);

      const conditions: SQL[] = [
        eq(webhookDeliveries.tenantId, tenantId),
        eq(webhookDeliveries.webhookEndpointId, endpointId),
      ];
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(webhookDeliveries.attemptedAt, new Date(c.attemptedAt)),
            and(eq(webhookDeliveries.attemptedAt, new Date(c.attemptedAt)), lt(webhookDeliveries.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.webhookDeliveries.findMany({
        where: and(...conditions),
        orderBy: [desc(webhookDeliveries.attemptedAt), desc(webhookDeliveries.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ attemptedAt: last.attemptedAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  // Signed test event (api.md §16.3) — delivered synchronously, bypassing
  // NATS entirely, and always treated as a final attempt: a manual test has
  // nothing to retry, so a failure dead-letters (and notifies) immediately
  // rather than silently queuing retries the caller never asked for.
  async test(tenantId: string, id: string) {
    const endpoint = await withTenant(this.db, tenantId, (tx) => this.requireEndpoint(tx, tenantId, id));
    return this.dispatch.deliverToEndpoint(endpoint, "webhook.test.v1", { message: "This is a test event from ConstructionOS." }, true);
  }

  private async requireEndpoint(tx: Database, tenantId: string, id: string) {
    const endpoint = await tx.query.webhookEndpoints.findFirst({
      where: and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id), isNull(webhookEndpoints.deletedAt)),
    });
    if (!endpoint) throw new WebhookEndpointNotFoundError();
    return endpoint;
  }
}
