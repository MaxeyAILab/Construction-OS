import Redis from "ioredis";
import type { Env } from "../../config/env";

export type RedisClient = Redis;

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

export function createRedisClient(env: Pick<Env, "REDIS_URL">): RedisClient {
  return new Redis(env.REDIS_URL);
}
