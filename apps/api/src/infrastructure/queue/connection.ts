import Redis from "ioredis";
import type { Env } from "../../config/env";

export const QUEUE_CONNECTION = Symbol("QUEUE_CONNECTION");

/**
 * BullMQ requires its own ioredis connection (not shared with app-level
 * caching/denylist usage) with `maxRetriesPerRequest: null` — BullMQ's
 * blocking commands manage their own retry/backoff and this option must be
 * disabled or BullMQ throws at startup.
 */
export function createQueueConnection(env: Pick<Env, "REDIS_URL">): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
