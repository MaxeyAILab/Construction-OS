import { Inject, Injectable } from "@nestjs/common";
import type { RedisClient } from "../../../infrastructure/redis/client";
import { REDIS_CLIENT } from "../../../infrastructure/redis/client";

const TTL_SECONDS = 300;

// architecture.md §12: "cached in Redis with event-driven invalidation;
// permission checks are in-memory per request (target < 1 ms)." The
// per-request part is satisfied by PermissionGuard resolving once per
// request and reusing the result for that request; this cache is the
// cross-request layer, invalidated whenever a tenant's role/permission
// grants change (RbacService calls invalidate() after every mutation).
@Injectable()
export class PermissionCacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async get(tenantId: string, userId: string): Promise<string[] | undefined> {
    const raw = await this.redis.get(this.key(tenantId, userId));
    return raw ? (JSON.parse(raw) as string[]) : undefined;
  }

  async set(tenantId: string, userId: string, permissions: string[]): Promise<void> {
    await this.redis.set(
      this.key(tenantId, userId),
      JSON.stringify(permissions),
      "EX",
      TTL_SECONDS,
    );
  }

  async invalidateUser(tenantId: string, userId: string): Promise<void> {
    await this.redis.del(this.key(tenantId, userId));
  }

  // Invalidates every cached user in a tenant — used when a role's
  // permission set changes, since we don't track role -> user fan-out here.
  async invalidateTenant(tenantId: string): Promise<void> {
    const pattern = this.key(tenantId, "*");
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  private key(tenantId: string, userId: string): string {
    return `rbac:permissions:${tenantId}:${userId}`;
  }
}
