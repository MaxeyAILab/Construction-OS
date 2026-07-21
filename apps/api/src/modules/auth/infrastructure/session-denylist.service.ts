import { Inject, Injectable } from "@nestjs/common";
import type { RedisClient } from "../../../infrastructure/redis/client";
import { REDIS_CLIENT } from "../../../infrastructure/redis/client";

// FR-PLAT-10 / architecture.md §11: "Session revocation is immediate:
// access tokens are short-lived and a Redis denylist covers the gap"
// between revoking a session and that session's already-issued access
// token naturally expiring (≤ 15 min).
@Injectable()
export class SessionDenylistService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async denylist(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.redis.set(this.key(jti), "1", "EX", ttlSeconds);
  }

  async isDenylisted(jti: string): Promise<boolean> {
    return (await this.redis.exists(this.key(jti))) === 1;
  }

  private key(jti: string): string {
    return `auth:denylist:${jti}`;
  }
}
