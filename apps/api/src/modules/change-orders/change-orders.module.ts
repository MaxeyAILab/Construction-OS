import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { RbacModule } from "../rbac";
import { ChangeOrdersController } from "./api/change-orders.controller";
import { ChangeOrderLifecycleService } from "./application/change-order-lifecycle.service";
import { ChangeOrdersService } from "./application/change-orders.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, RbacModule],
  controllers: [ChangeOrdersController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    ChangeOrdersService,
    ChangeOrderLifecycleService,
  ],
})
export class ChangeOrdersModule {}
