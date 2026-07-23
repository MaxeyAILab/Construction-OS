import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { StockService } from "../../src/modules/inventory/application/stock.service";
import { DeliveriesService } from "../../src/modules/procurement/application/deliveries.service";
import { PurchaseOrderLifecycleService } from "../../src/modules/procurement/application/purchase-order-lifecycle.service";
import { PurchaseOrdersService } from "../../src/modules/procurement/application/purchase-orders.service";
import { RfqsService } from "../../src/modules/procurement/application/rfqs.service";
import { SuppliersService } from "../../src/modules/procurement/application/suppliers.service";

export function buildTestProcurementServices(db: Database, stockService: StockService) {
  const outbox = new OutboxService();
  const suppliersService = new SuppliersService(db, outbox);
  const purchaseOrdersService = new PurchaseOrdersService(db, outbox, suppliersService);
  return {
    suppliersService,
    purchaseOrdersService,
    lifecycleService: new PurchaseOrderLifecycleService(db, outbox, purchaseOrdersService),
    rfqsService: new RfqsService(db, outbox, suppliersService),
    deliveriesService: new DeliveriesService(db, outbox, stockService),
  };
}
