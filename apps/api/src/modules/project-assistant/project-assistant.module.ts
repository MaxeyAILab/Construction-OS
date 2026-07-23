import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { AiModule } from "../ai";
import { DashboardsModule } from "../dashboards";
import { RagModule } from "../rag";
import { RbacModule } from "../rbac";
import { RfisModule } from "../rfis";
import { TasksModule } from "../tasks";
import { ProjectAssistantController } from "./api/project-assistant.controller";
import { ProjectAssistantService } from "./application/project-assistant.service";

const env = loadEnv();

@Module({
  imports: [AiModule, RbacModule, RagModule, DashboardsModule, TasksModule, RfisModule],
  controllers: [ProjectAssistantController],
  providers: [{ provide: DATABASE, useFactory: () => createDatabase(env) }, ProjectAssistantService],
})
export class ProjectAssistantModule {}
