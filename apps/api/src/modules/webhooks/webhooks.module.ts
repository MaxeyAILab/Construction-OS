import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createNatsConnection, ensureEventStream, NATS_CONNECTION } from "../../infrastructure/nats/client";
import { EncryptionService } from "../auth";
import { EventsModule } from "../events";
import { WebhooksController } from "./api/webhooks.controller";
import { WebhookDispatchService } from "./application/webhook-dispatch.service";
import { WebhooksService } from "./application/webhooks.service";
import { WebhookDispatchConsumerWorker } from "./infrastructure/webhook-dispatch-consumer.worker";

const env = loadEnv();

@Module({
  imports: [EventsModule],
  controllers: [WebhooksController],
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
    { provide: EncryptionService, useFactory: () => new EncryptionService(env.WEBHOOK_ENCRYPTION_KEY) },
    WebhookDispatchService,
    WebhooksService,
    WebhookDispatchConsumerWorker,
  ],
})
export class WebhooksModule {}
