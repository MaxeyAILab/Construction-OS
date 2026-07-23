import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { InventoryModule } from "../inventory";
import { PurchaseOrdersController } from "./api/purchase-orders.controller";
import { RfqsController } from "./api/rfqs.controller";
import { SuppliersController } from "./api/suppliers.controller";
import { DeliveriesService } from "./application/deliveries.service";
import { PurchaseOrderLifecycleService } from "./application/purchase-order-lifecycle.service";
import { PurchaseOrdersService } from "./application/purchase-orders.service";
import { RfqsService } from "./application/rfqs.service";
import { SuppliersService } from "./application/suppliers.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, InventoryModule],
  controllers: [SuppliersController, PurchaseOrdersController, RfqsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    SuppliersService,
    PurchaseOrdersService,
    PurchaseOrderLifecycleService,
    RfqsService,
    DeliveriesService,
  ],
})
export class ProcurementModule {}
