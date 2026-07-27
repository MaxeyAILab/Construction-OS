import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { StockService } from "../../src/modules/inventory/application/stock.service";
import { DeliveriesService } from "../../src/modules/procurement/application/deliveries.service";
import { PurchaseOrderLifecycleService } from "../../src/modules/procurement/application/purchase-order-lifecycle.service";
import { PurchaseOrdersService } from "../../src/modules/procurement/application/purchase-orders.service";
import { RfqsService } from "../../src/modules/procurement/application/rfqs.service";
import { SuppliersService } from "../../src/modules/procurement/application/suppliers.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestProcurementServices(db: Database, stockService: StockService): {
  suppliersService: SuppliersService;
  purchaseOrdersService: PurchaseOrdersService;
  lifecycleService: PurchaseOrderLifecycleService;
  rfqsService: RfqsService;
  deliveriesService: DeliveriesService;
  redis: RedisClient;
} {
  const outbox = new OutboxService();
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(redis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);

  const suppliersService = new SuppliersService(db, outbox);
  const purchaseOrdersService = new PurchaseOrdersService(db, outbox, suppliersService, permissions, externalShares);
  return {
    suppliersService,
    purchaseOrdersService,
    lifecycleService: new PurchaseOrderLifecycleService(db, outbox, purchaseOrdersService, permissions, externalShares),
    rfqsService: new RfqsService(db, outbox, suppliersService),
    deliveriesService: new DeliveriesService(db, outbox, stockService),
    redis,
  };
}
