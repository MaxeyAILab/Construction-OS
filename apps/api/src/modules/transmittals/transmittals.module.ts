import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { RbacModule } from "../rbac";
import { ApprovalInstancesController } from "./api/approval-instances.controller";
import { ApprovalMatricesController } from "./api/approval-matrices.controller";
import { TransmittalsController } from "./api/transmittals.controller";
import { ApprovalInstancesService } from "./application/approval-instances.service";
import { ApprovalMatricesService } from "./application/approval-matrices.service";
import { TransmittalsService } from "./application/transmittals.service";

const env = loadEnv();

// database.md §25 / api.md §20 (M3, FR-DOC-8/9).
@Module({
  imports: [EventsModule, RbacModule],
  controllers: [TransmittalsController, ApprovalMatricesController, ApprovalInstancesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    TransmittalsService,
    ApprovalMatricesService,
    ApprovalInstancesService,
  ],
  exports: [TransmittalsService, ApprovalMatricesService, ApprovalInstancesService],
})
export class TransmittalsModule {}
