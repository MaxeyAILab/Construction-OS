import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { AiController } from "./api/ai.controller";
import { AiGatewayService } from "./application/ai-gateway.service";
import { AI_PROVIDER } from "./domain/ai-provider";
import { AnthropicProvider } from "./infrastructure/anthropic-provider";

const env = loadEnv();

@Module({
  controllers: [AiController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: AI_PROVIDER, useFactory: () => new AnthropicProvider(env.ANTHROPIC_API_KEY) },
    AiGatewayService,
  ],
  // Phase 1D's later AI rows (RAG pipeline, Project Assistant, Photo AI,
  // etc. — roadmap.md) will inject this the same way every other module
  // exports its core service for cross-module reuse (e.g. TasksModule
  // exporting TasksService for the sync engine).
  exports: [AiGatewayService],
})
export class AiModule {}
