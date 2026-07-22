import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { CommentsModule } from "../comments";
import { EventsModule } from "../events";
import { TasksController } from "./api/tasks.controller";
import { TasksService } from "./application/tasks.service";

const env = loadEnv();

@Module({
  imports: [EventsModule, CommentsModule],
  controllers: [TasksController],
  providers: [{ provide: DATABASE, useFactory: () => createDatabase(env) }, TasksService],
  // M6 Mobile Sync (architecture.md §14.2) reuses TasksService for its
  // 'tasks' mutation handler rather than duplicating create/update/delete
  // logic — same "broaden an existing module's public surface for a
  // legitimate new cross-module need" precedent as Projects' CostCodesService.
  exports: [TasksService],
})
export class TasksModule {}
