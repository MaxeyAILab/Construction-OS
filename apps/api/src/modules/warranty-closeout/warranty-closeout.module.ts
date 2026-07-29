import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { FilesModule } from "../files";
import { RbacModule } from "../rbac";
import { CloseoutChecklistController } from "./api/closeout-checklist.controller";
import { CloseoutPackagesController } from "./api/closeout-packages.controller";
import { WarrantiesController } from "./api/warranties.controller";
import { WarrantyClaimsController } from "./api/warranty-claims.controller";
import { CloseoutChecklistService } from "./application/closeout-checklist.service";
import { CloseoutPackagesService } from "./application/closeout-packages.service";
import { WarrantiesService } from "./application/warranties.service";
import { WarrantyClaimsService } from "./application/warranty-claims.service";

const env = loadEnv();

// spec.md §13.18 / api.md §18 (M19).
@Module({
  imports: [EventsModule, FilesModule, RbacModule],
  controllers: [
    CloseoutChecklistController,
    CloseoutPackagesController,
    WarrantiesController,
    WarrantyClaimsController,
  ],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    CloseoutChecklistService,
    CloseoutPackagesService,
    WarrantiesService,
    WarrantyClaimsService,
  ],
  exports: [CloseoutChecklistService, CloseoutPackagesService, WarrantiesService, WarrantyClaimsService],
})
export class WarrantyCloseoutModule {}
