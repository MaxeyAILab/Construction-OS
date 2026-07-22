import type { Database } from "../../src/infrastructure/db/client";
import { BudgetService } from "../../src/modules/budgets/application/budget.service";
import { CostTransactionsService } from "../../src/modules/budgets/application/cost-transactions.service";
import { FinancialSummaryService } from "../../src/modules/budgets/application/financial-summary.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

export function buildTestBudgetServices(db: Database) {
  const outbox = new OutboxService();
  return {
    budgetService: new BudgetService(db, outbox),
    costTransactionsService: new CostTransactionsService(db, outbox),
    financialSummaryService: new FinancialSummaryService(db),
  };
}
