import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { AiModule } from "../ai";
import { EventsModule } from "../events";
import { SubcontractorsModule } from "../subcontractors";
import { BidPackagesController } from "./api/bid-packages.controller";
import { EstimatingController } from "./api/estimating.controller";
import { BidInvitationsService } from "./application/bid-invitations.service";
import { BidLevelingService } from "./application/bid-leveling.service";
import { BidPackagesService } from "./application/bid-packages.service";
import { BidsService } from "./application/bids.service";
import { CostBookService } from "./application/cost-book.service";
import { ConvertToBudgetService } from "./application/convert-to-budget.service";
import { EstimateLinesService } from "./application/estimate-lines.service";
import { EstimateService } from "./application/estimate.service";
import { EstimatorAiService } from "./application/estimator-ai.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, SubcontractorsModule, AiModule],
  controllers: [EstimatingController, BidPackagesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    CostBookService,
    EstimateService,
    EstimateLinesService,
    ConvertToBudgetService,
    BidPackagesService,
    BidInvitationsService,
    BidsService,
    BidLevelingService,
    EstimatorAiService,
  ],
})
export class EstimatingModule {}
