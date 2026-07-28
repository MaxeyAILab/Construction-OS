import type { Database } from "../../src/infrastructure/db/client";
import { AgentIdentitiesService } from "../../src/modules/agents/application/agent-identities.service";
import { BillingAgentRunnerService } from "../../src/modules/agents/application/billing-agent-runner.service";
import { ComplianceAgentRunnerService } from "../../src/modules/agents/application/compliance-agent-runner.service";
import { ProcurementAgentRunnerService } from "../../src/modules/agents/application/procurement-agent-runner.service";
import type { BudgetService } from "../../src/modules/budgets/application/budget.service";
import type { ComplianceAlertsService } from "../../src/modules/compliance-alerts/application/compliance-alerts.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { PaymentApplicationsService } from "../../src/modules/finance/application/payment-applications.service";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import type { ProcurementNeedsService } from "../../src/modules/procurement/application/procurement-needs.service";
import type { PurchaseOrderLifecycleService } from "../../src/modules/procurement/application/purchase-order-lifecycle.service";
import { RbacService } from "../../src/modules/rbac/application/rbac.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import type { CertificationsService } from "../../src/modules/safety/application/certifications.service";
import type { SchedulesService } from "../../src/modules/scheduling/application/schedules.service";

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

// api.md §15.3: wires BillingAgentRunnerService directly (bypassing
// BillingAgentWorker's BullMQ scheduling), same "test the runner, not the
// queue" split as buildTestProcurementAgentRunner above.
export function buildTestBillingAgentRunner(
  db: Database,
  agents: AgentIdentitiesService,
  budgetService: BudgetService,
  schedulesService: SchedulesService,
  paymentApplications: PaymentApplicationsService,
): BillingAgentRunnerService {
  return new BillingAgentRunnerService(db, agents, budgetService, schedulesService, paymentApplications);
}

// api.md §15.4: wires ComplianceAgentRunnerService directly (bypassing
// ComplianceAgentWorker's BullMQ scheduling), same "test the runner, not
// the queue" split as the two runners above.
export function buildTestComplianceAgentRunner(
  db: Database,
  agents: AgentIdentitiesService,
  certifications: CertificationsService,
  complianceAlerts: ComplianceAlertsService,
): ComplianceAgentRunnerService {
  return new ComplianceAgentRunnerService(db, agents, certifications, complianceAlerts);
}
