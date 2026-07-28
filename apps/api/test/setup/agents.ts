import type { Database } from "../../src/infrastructure/db/client";
import { AgentIdentitiesService } from "../../src/modules/agents/application/agent-identities.service";
import { ProcurementAgentRunnerService } from "../../src/modules/agents/application/procurement-agent-runner.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import type { ProcurementNeedsService } from "../../src/modules/procurement/application/procurement-needs.service";
import type { PurchaseOrderLifecycleService } from "../../src/modules/procurement/application/purchase-order-lifecycle.service";
import { RbacService } from "../../src/modules/rbac/application/rbac.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestAgentIdentitiesService(db: Database): { agents: AgentIdentitiesService; redis: RedisClient } {
  const outbox = new OutboxService();
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const rbac = new RbacService(db, new PermissionCacheService(redis), outbox);
  return { agents: new AgentIdentitiesService(db, outbox, rbac), redis };
}

// api.md §15.2: wires ProcurementAgentRunnerService directly (bypassing
// ProcurementAgentWorker's BullMQ scheduling) so tests can call runTick()
// synchronously, same "test the runner, not the queue" split as every
// other *-runner.service.ts in this codebase.
export function buildTestProcurementAgentRunner(
  db: Database,
  agents: AgentIdentitiesService,
  procurementNeeds: ProcurementNeedsService,
  lifecycle: PurchaseOrderLifecycleService,
): ProcurementAgentRunnerService {
  return new ProcurementAgentRunnerService(db, agents, procurementNeeds, lifecycle);
}
