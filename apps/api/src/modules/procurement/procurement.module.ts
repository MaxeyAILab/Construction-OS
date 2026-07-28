import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { AiModule } from "../ai";
import { BudgetsModule } from "../budgets";
import { EventsModule } from "../events";
import { InventoryModule } from "../inventory";
import { RbacModule } from "../rbac";
import { SchedulingModule } from "../scheduling";
import { ProcurementAiController } from "./api/procurement-ai.controller";
import { PurchaseOrdersController } from "./api/purchase-orders.controller";
import { RfqsController } from "./api/rfqs.controller";
import { SuppliersController } from "./api/suppliers.controller";
import { DeliveriesService } from "./application/deliveries.service";
import { ProcurementNeedsService } from "./application/procurement-needs.service";
import { PurchaseOrderLifecycleService } from "./application/purchase-order-lifecycle.service";
import { PurchaseOrdersService } from "./application/purchase-orders.service";
import { RfqsService } from "./application/rfqs.service";
import { SupplierScoringService } from "./application/supplier-scoring.service";
import { SuppliersService } from "./application/suppliers.service";

const env = loadEnv();

@Module({
  // BudgetsModule/SchedulingModule: Procurement AI (FR-PROC-6) needs both
  // budget_lines' remaining balance and schedule_activities' cost-code/
  // start-date data. Neither module imports Procurement back (checked),
  // so this doesn't create a cycle — unlike Finance, which already
  // depends on Procurement and therefore can't be depended on in return
  // (see SupplierScoringService's doc comment on dispute_count).
  imports: [EventsModule, InventoryModule, RbacModule, BudgetsModule, SchedulingModule, AiModule],
  controllers: [SuppliersController, PurchaseOrdersController, RfqsController, ProcurementAiController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    SuppliersService,
    SupplierScoringService,
    PurchaseOrdersService,
    PurchaseOrderLifecycleService,
    RfqsService,
    DeliveriesService,
    ProcurementNeedsService,
  ],
  // Supplier Portal (M15) + Finance invoices (Finance module) reuse
  // PurchaseOrdersService for PO/line lookups (2-/3-way match, FR-VEND-2)
  // and SuppliersService for counterparty validation — same "broaden an
  // existing module's public surface" precedent as every other
  // cross-module reuse this session. ProcurementNeedsService/
  // PurchaseOrderLifecycleService are additionally exported for
  // ProcurementAgentRunnerService (api.md §15.2), which composes
  // draftFromNeeds + submit under an agent's own actor.
  exports: [PurchaseOrdersService, SuppliersService, ProcurementNeedsService, PurchaseOrderLifecycleService],
})
export class ProcurementModule {}
