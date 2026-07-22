import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { CostBookService } from "../../src/modules/estimating/application/cost-book.service";
import { ConvertToBudgetService } from "../../src/modules/estimating/application/convert-to-budget.service";
import { EstimateLinesService } from "../../src/modules/estimating/application/estimate-lines.service";
import { EstimateService } from "../../src/modules/estimating/application/estimate.service";

export function buildTestEstimatingServices(db: Database) {
  const outbox = new OutboxService();
  const estimateService = new EstimateService(db, outbox);
  return {
    estimateService,
    estimateLinesService: new EstimateLinesService(db, outbox, estimateService),
    costBookService: new CostBookService(db, outbox),
    convertToBudgetService: new ConvertToBudgetService(db, outbox),
  };
}
