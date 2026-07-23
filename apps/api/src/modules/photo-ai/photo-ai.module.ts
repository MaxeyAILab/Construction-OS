import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createNatsConnection, ensureEventStream, NATS_CONNECTION } from "../../infrastructure/nats/client";
import { AiModule } from "../ai";
import { EventsModule } from "../events";
import { FilesModule } from "../files";
import { PhotosModule } from "../photos";
import { PhotoAiWriterService } from "./application/photo-ai-writer.service";
import { PhotoAiService } from "./application/photo-ai.service";
import { PhotoAiConsumerWorker } from "./infrastructure/photo-ai-consumer.worker";

const env = loadEnv();

@Module({
  imports: [AiModule, EventsModule, FilesModule, PhotosModule],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    // Own NATS connection, same "each event-consumer module owns its own
    // connection, independent of every other module's" precedent as
    // RagModule/DashboardsModule.
    {
      provide: NATS_CONNECTION,
      useFactory: async () => {
        const nc = await createNatsConnection(env);
        await ensureEventStream(nc);
        return nc;
      },
    },
    PhotoAiService,
    PhotoAiWriterService,
    PhotoAiConsumerWorker,
  ],
})
export class PhotoAiModule {}
