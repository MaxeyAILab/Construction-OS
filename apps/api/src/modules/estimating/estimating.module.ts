import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { EstimatingController } from "./api/estimating.controller";
import { CostBookService } from "./application/cost-book.service";
import { ConvertToBudgetService } from "./application/convert-to-budget.service";
import { EstimateLinesService } from "./application/estimate-lines.service";
import { EstimateService } from "./application/estimate.service";

const env = loadEnv();

@Module({
  imports: [EventsModule],
  controllers: [EstimatingController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    CostBookService,
    EstimateService,
    EstimateLinesService,
    ConvertToBudgetService,
  ],
})
export class EstimatingModule {}
