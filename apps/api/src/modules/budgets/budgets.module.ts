import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { BudgetsController } from "./api/budgets.controller";
import { BudgetService } from "./application/budget.service";
import { CostTransactionsService } from "./application/cost-transactions.service";
import { FinancialSummaryService } from "./application/financial-summary.service";

const env = loadEnv();

@Module({
  imports: [EventsModule],
  controllers: [BudgetsController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    BudgetService,
    CostTransactionsService,
    FinancialSummaryService,
  ],
  // M8 Field Operations (FR-FIELD-2) reuses CostTransactionsService for time
  // entry approval rather than duplicating the actual_amount/budget-line
  // update logic — same precedent as TasksModule exporting TasksService for
  // the sync mutation engine.
  exports: [CostTransactionsService],
})
export class BudgetsModule {}
