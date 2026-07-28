import type { Database } from "../../src/infrastructure/db/client";
import { AgentIdentitiesService } from "../../src/modules/agents/application/agent-identities.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { RbacService } from "../../src/modules/rbac/application/rbac.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestAgentIdentitiesService(db: Database): { agents: AgentIdentitiesService; redis: RedisClient } {
  const outbox = new OutboxService();
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const rbac = new RbacService(db, new PermissionCacheService(redis), outbox);
  return { agents: new AgentIdentitiesService(db, outbox, rbac), redis };
}
