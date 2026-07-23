import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createNatsConnection, ensureEventStream, NATS_CONNECTION } from "../../infrastructure/nats/client";
import { DailyReportsModule } from "../daily-reports";
import { PhotosModule } from "../photos";
import { RbacModule } from "../rbac";
import { RfisModule } from "../rfis";
import { TasksModule } from "../tasks";
import { RagSearchController } from "./api/rag-search.controller";
import { RagIndexingWriterService } from "./application/rag-indexing-writer.service";
import { RagIndexingService } from "./application/rag-indexing.service";
import { RagSearchService } from "./application/rag-search.service";
import { EMBEDDING_PROVIDER } from "./domain/embedding-provider";
import { RagIndexingConsumerWorker } from "./infrastructure/rag-indexing-consumer.worker";
import { VoyageEmbeddingProvider } from "./infrastructure/voyage-embedding-provider";

const env = loadEnv();

@Module({
  imports: [RbacModule, TasksModule, RfisModule, DailyReportsModule, PhotosModule],
  controllers: [RagSearchController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    // Own NATS connection, same "each event consumer owns its own
    // connection, independent of every other module's" precedent as
    // DashboardsModule/EventsModule.
    {
      provide: NATS_CONNECTION,
      useFactory: async () => {
        const nc = await createNatsConnection(env);
        await ensureEventStream(nc);
        return nc;
      },
    },
    { provide: EMBEDDING_PROVIDER, useFactory: () => new VoyageEmbeddingProvider(env.VOYAGE_API_KEY) },
    RagIndexingService,
    RagIndexingWriterService,
    RagIndexingConsumerWorker,
    RagSearchService,
  ],
  // M17 Project Assistant (ai-spec.md §7.2) reuses RagSearchService as its
  // "search_project_records" tool rather than duplicating hybrid-
  // retrieval logic — same "broaden an existing module's public surface
  // for a legitimate new cross-module need" precedent as
  // TasksModule/RfisModule/DailyReportsModule already exporting their own
  // services.
  exports: [RagSearchService],
})
export class RagModule {}
