import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { SubmittalsController } from "./api/submittals.controller";
import { SubmittalsService } from "./application/submittals.service";

const env = loadEnv();

@Module({
  imports: [EventsModule],
  controllers: [SubmittalsController],
  providers: [{ provide: DATABASE, useFactory: () => createDatabase(env) }, SubmittalsService],
})
export class SubmittalsModule {}
