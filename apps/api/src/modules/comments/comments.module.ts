import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { EventsModule } from "../events";
import { CommentsService } from "./application/comments.service";

const env = loadEnv();

// No controller: like the files module, this is generic reusable infra —
// consuming modules (Tasks, later RFIs/POs) expose their own
// api.md-documented comment endpoint and call this service directly.
@Module({
  imports: [EventsModule],
  providers: [{ provide: DATABASE, useFactory: () => createDatabase(env) }, CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
