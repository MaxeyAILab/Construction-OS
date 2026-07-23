import type { Database } from "../../src/infrastructure/db/client";
import { CostTransactionsService } from "../../src/modules/budgets/application/cost-transactions.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { InventoryItemsService } from "../../src/modules/inventory/application/inventory-items.service";
import { InventoryLocationsService } from "../../src/modules/inventory/application/inventory-locations.service";
import { StockService } from "../../src/modules/inventory/application/stock.service";

export function buildTestInventoryServices(db: Database) {
  const outbox = new OutboxService();
  const itemsService = new InventoryItemsService(db, outbox);
  const locationsService = new InventoryLocationsService(db, outbox);
  const costTransactionsService = new CostTransactionsService(db, outbox);
  return {
    itemsService,
    locationsService,
    stockService: new StockService(db, outbox, itemsService, locationsService, costTransactionsService),
  };
}
