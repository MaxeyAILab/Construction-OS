import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { RfisController } from "./api/rfis.controller";
import { RfisService } from "./application/rfis.service";

const env = loadEnv();

@Module({
  imports: [EventsModule],
  controllers: [RfisController],
  providers: [{ provide: DATABASE, useFactory: () => createDatabase(env) }, RfisService],
})
export class RfisModule {}
