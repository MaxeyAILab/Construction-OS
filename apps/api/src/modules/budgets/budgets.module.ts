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
})
export class BudgetsModule {}
