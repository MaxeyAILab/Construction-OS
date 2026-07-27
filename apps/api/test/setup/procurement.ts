import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../../src/modules/ai/domain/ai-provider";
import type { BudgetService } from "../../src/modules/budgets/application/budget.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { StockService } from "../../src/modules/inventory/application/stock.service";
import { DeliveriesService } from "../../src/modules/procurement/application/deliveries.service";
import { ProcurementNeedsService } from "../../src/modules/procurement/application/procurement-needs.service";
import { PurchaseOrderLifecycleService } from "../../src/modules/procurement/application/purchase-order-lifecycle.service";
import { PurchaseOrdersService } from "../../src/modules/procurement/application/purchase-orders.service";
import { RfqsService } from "../../src/modules/procurement/application/rfqs.service";
import { SupplierScoringService } from "../../src/modules/procurement/application/supplier-scoring.service";
import { SuppliersService } from "../../src/modules/procurement/application/suppliers.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import type { SchedulesService } from "../../src/modules/scheduling/application/schedules.service";

// Same "real double, not a network client" role as FakeAiProvider —
// always returns a fixed rationale for the one plain-completion call
// ProcurementNeedsService.explainDrafting() makes.
class FakeProcurementRationaleProvider implements AiProvider {
  async complete(_request: AiCompletionRequest): Promise<AiCompletionResult> {
    return { content: "Drafting now keeps lead time and buffer covered before the schedule need date.", inputTokens: 80, outputTokens: 30 };
  }
}

export function buildTestProcurementServices(
  db: Database,
  stockService: StockService,
  schedulesService: SchedulesService,
  budgetService: BudgetService,
): {
  suppliersService: SuppliersService;
  supplierScoringService: SupplierScoringService;
  purchaseOrdersService: PurchaseOrdersService;
  lifecycleService: PurchaseOrderLifecycleService;
  rfqsService: RfqsService;
  deliveriesService: DeliveriesService;
  procurementNeedsService: ProcurementNeedsService;
  redis: RedisClient;
} {
  const outbox = new OutboxService();
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(redis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);

  const suppliersService = new SuppliersService(db, outbox);
  const purchaseOrdersService = new PurchaseOrdersService(db, outbox, suppliersService, permissions, externalShares);
  const aiGatewayService = new AiGatewayService(db, new FakeProcurementRationaleProvider());
  return {
    suppliersService,
    supplierScoringService: new SupplierScoringService(db, outbox, suppliersService),
    purchaseOrdersService,
    lifecycleService: new PurchaseOrderLifecycleService(db, outbox, purchaseOrdersService, permissions, externalShares),
    rfqsService: new RfqsService(db, outbox, suppliersService),
    deliveriesService: new DeliveriesService(db, outbox, stockService),
    procurementNeedsService: new ProcurementNeedsService(db, schedulesService, budgetService, purchaseOrdersService, aiGatewayService),
    redis,
  };
}
