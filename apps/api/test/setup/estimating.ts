import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { BidInvitationsService } from "../../src/modules/estimating/application/bid-invitations.service";
import { BidPackagesService } from "../../src/modules/estimating/application/bid-packages.service";
import { BidsService } from "../../src/modules/estimating/application/bids.service";
import { CostBookService } from "../../src/modules/estimating/application/cost-book.service";
import { ConvertToBudgetService } from "../../src/modules/estimating/application/convert-to-budget.service";
import { EstimateLinesService } from "../../src/modules/estimating/application/estimate-lines.service";
import { EstimateService } from "../../src/modules/estimating/application/estimate.service";
import type { SubcontractorsService } from "../../src/modules/subcontractors/application/subcontractors.service";

export function buildTestEstimatingServices(db: Database, subcontractorsService: SubcontractorsService) {
  const outbox = new OutboxService();
  const estimateService = new EstimateService(db, outbox);
  const bidPackagesService = new BidPackagesService(db, outbox);
  const bidInvitationsService = new BidInvitationsService(db, outbox, bidPackagesService, subcontractorsService);
  return {
    estimateService,
    estimateLinesService: new EstimateLinesService(db, outbox, estimateService),
    costBookService: new CostBookService(db, outbox),
    convertToBudgetService: new ConvertToBudgetService(db, outbox),
    bidPackagesService,
    bidInvitationsService,
    bidsService: new BidsService(db, outbox, bidInvitationsService),
  };
}
