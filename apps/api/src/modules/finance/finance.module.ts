import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { BudgetsModule } from "../budgets";
import { CrmModule } from "../crm";
import { EventsModule } from "../events";
import { ProcurementModule } from "../procurement";
import { SubcontractorsModule } from "../subcontractors";
import { InvoicesController } from "./api/invoices.controller";
import { InvoicesService } from "./application/invoices.service";
import { PaymentsService } from "./application/payments.service";

const env = loadEnv();

// Supplier Portal (M15) + Finance invoices (api.md §10, database.md §11).
// A separate module from Budgets purely to avoid a NestJS module import
// cycle — see InvoicesService's own doc comment for the full reasoning.
// Sits strictly above Budgets/Procurement/Subcontractors/Crm; nothing
// imports FinanceModule back.
@Module({
  imports: [EventsModule, BudgetsModule, ProcurementModule, SubcontractorsModule, CrmModule],
  controllers: [InvoicesController],
  providers: [{ provide: DATABASE, useFactory: () => createDatabase(env) }, InvoicesService, PaymentsService],
})
export class FinanceModule {}
