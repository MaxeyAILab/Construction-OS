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
})
export class TasksModule {}
