import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { RbacModule } from "../rbac";
import { CustomFieldAdminController } from "./api/custom-field-admin.controller";
import { CustomFieldValuesController } from "./api/custom-field-values.controller";
import { CustomFieldAutomationsService } from "./application/custom-field-automations.service";
import { CustomFieldDefinitionsService } from "./application/custom-field-definitions.service";
import { CustomFieldValuesService } from "./application/custom-field-values.service";

const env = loadEnv();

// database.md §24 / api.md §19 (M18, FR-PLAT-11/12).
@Module({
  imports: [EventsModule, RbacModule],
  controllers: [CustomFieldAdminController, CustomFieldValuesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    CustomFieldDefinitionsService,
    CustomFieldAutomationsService,
    CustomFieldValuesService,
  ],
  exports: [CustomFieldDefinitionsService, CustomFieldAutomationsService, CustomFieldValuesService],
})
export class CustomFieldsModule {}
