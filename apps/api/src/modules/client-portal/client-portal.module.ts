import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { RbacModule } from "../rbac";
import { PortalMessagesController } from "./api/portal-messages.controller";
import { SelectionsController } from "./api/selections.controller";
import { PortalMessagesService } from "./application/portal-messages.service";
import { SelectionsService } from "./application/selections.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, RbacModule],
  controllers: [SelectionsController, PortalMessagesController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    SelectionsService,
    PortalMessagesService,
  ],
})
export class ClientPortalModule {}
