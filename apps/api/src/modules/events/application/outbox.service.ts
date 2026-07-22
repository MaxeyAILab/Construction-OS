import { Injectable } from "@nestjs/common";
import { type EventType, eventRegistry } from "@constructionos/schemas";
import type { Database } from "../../../infrastructure/db/client";
import { outbox } from "../../../infrastructure/db/schema";
import { InvalidEventPayloadError, UnknownEventTypeError } from "../domain/errors";

export interface AppendEventInput {
  tenantId: string;
  eventType: EventType;
  payload: unknown;
  dedupeKey: string;
}

/**
 * architecture.md §8: events are written in the *same transaction* as the
 * domain change they describe, so callers must pass the open transaction
 * (the `tx` from an in-flight `withTenant(...)` call) rather than a fresh
 * connection — never append outside the caller's transaction boundary.
 */
@Injectable()
export class OutboxService {
  async append(tx: Database, input: AppendEventInput): Promise<void> {
    const schema = eventRegistry[input.eventType] as (typeof eventRegistry)[EventType] | undefined;
    if (!schema) throw new UnknownEventTypeError(input.eventType);

    const parsed = schema.safeParse(input.payload);
    if (!parsed.success) {
      throw new InvalidEventPayloadError(input.eventType, parsed.error.message);
    }

    await tx.insert(outbox).values({
      tenantId: input.tenantId,
      eventType: input.eventType,
      payload: parsed.data,
      dedupeKey: input.dedupeKey,
    });
  }
}
