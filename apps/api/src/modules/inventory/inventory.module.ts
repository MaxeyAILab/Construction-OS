import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { BudgetsModule } from "../budgets";
import { EventsModule } from "../events";
import { InventoryItemsController } from "./api/inventory-items.controller";
import { InventoryLocationsController } from "./api/inventory-locations.controller";
import { StockController } from "./api/stock.controller";
import { InventoryItemsService } from "./application/inventory-items.service";
import { InventoryLocationsService } from "./application/inventory-locations.service";
import { StockService } from "./application/stock.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, BudgetsModule],
  controllers: [InventoryItemsController, InventoryLocationsController, StockController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    InventoryItemsService,
    InventoryLocationsService,
    StockService,
  ],
  exports: [InventoryItemsService, InventoryLocationsService, StockService],
})
export class InventoryModule {}
