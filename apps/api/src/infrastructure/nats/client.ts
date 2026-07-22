import { connect, type NatsConnection, StorageType } from "nats";
import type { Env } from "../../config/env";

export const NATS_CONNECTION = Symbol("NATS_CONNECTION");

export async function createNatsConnection(env: Pick<Env, "NATS_URL">): Promise<NatsConnection> {
  return connect({ servers: env.NATS_URL });
}

// architecture.md §8: every domain event publishes to `events.<eventType>`
// on a single JetStream stream, so consumers can subscribe with a subject
// filter (e.g. `events.company.>`) instead of one subscription per type.
export const EVENTS_STREAM_NAME = "EVENTS";
export const EVENTS_STREAM_SUBJECTS = ["events.>"];

export function eventSubject(eventType: string): string {
  return `events.${eventType}`;
}

/**
 * Idempotent: creates the EVENTS stream if missing, updates its subject
 * filter if it already exists but drifted. Safe to call on every boot.
 */
export async function ensureEventStream(nc: NatsConnection): Promise<void> {
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.info(EVENTS_STREAM_NAME);
    await jsm.streams.update(EVENTS_STREAM_NAME, { subjects: EVENTS_STREAM_SUBJECTS });
  } catch {
    await jsm.streams.add({
      name: EVENTS_STREAM_NAME,
      subjects: EVENTS_STREAM_SUBJECTS,
      // File storage: the outbox is the durable source of truth, but a
      // restart shouldn't silently drop events already in flight to
      // JetStream consumers between relay and consumption.
      storage: StorageType.File,
    });
  }
}
