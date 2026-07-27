import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { SafetyModule } from "../safety";
import { SubcontractorsController } from "./api/subcontractors.controller";
import { SubcontractsController } from "./api/subcontracts.controller";
import { SubcontractorsService } from "./application/subcontractors.service";
import { SubcontractsService } from "./application/subcontracts.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, SafetyModule],
  controllers: [SubcontractorsController, SubcontractsController],
  providers: [{ provide: DATABASE, useFactory: () => createDatabase(env) }, SubcontractorsService, SubcontractsService],
  // Estimating's bidding services (FR-EST-6) reuse SubcontractorsService
  // for eligibility gating (FR-SUB-2) and existence checks — same
  // "broaden an existing module's public surface" precedent as
  // TasksService being reused by Safety's IncidentsService.
  exports: [SubcontractorsService, SubcontractsService],
})
export class SubcontractorsModule {}
