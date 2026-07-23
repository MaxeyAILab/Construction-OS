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
  // M17 RAG (roadmap.md "RAG pipeline + NL search") reuses RfisService to
  // render RFIs for indexing — same "broaden an existing module's public
  // surface for a legitimate new cross-module need" precedent as
  // TasksModule/DailyReportsModule already exporting their own services.
  exports: [RfisService],
})
export class RfisModule {}
