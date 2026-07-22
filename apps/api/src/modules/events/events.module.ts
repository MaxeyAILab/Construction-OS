import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import {
  createNatsConnection,
  ensureEventStream,
  NATS_CONNECTION,
} from "../../infrastructure/nats/client";
import { createQueueConnection, QUEUE_CONNECTION } from "../../infrastructure/queue/connection";
import { OutboxService } from "./application/outbox.service";
import { RelayService } from "./application/relay.service";
import { RelayWorker } from "./infrastructure/relay.worker";

const env = loadEnv();

@Module({
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    {
      provide: NATS_CONNECTION,
      useFactory: async () => {
        const nc = await createNatsConnection(env);
        await ensureEventStream(nc);
        return nc;
      },
    },
    { provide: QUEUE_CONNECTION, useFactory: () => createQueueConnection(env) },
    OutboxService,
    RelayService,
    RelayWorker,
  ],
  exports: [OutboxService],
})
export class EventsModule {}
