import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import {
  createNatsConnection,
  ensureEventStream,
  NATS_CONNECTION,
} from "../../infrastructure/nats/client";
import { NotificationsController } from "./api/notifications.controller";
import { DispatchService } from "./application/dispatch.service";
import { NotificationsService } from "./application/notifications.service";
import { EMAIL_CHANNEL, PUSH_CHANNEL } from "./infrastructure/channels/channel.interface";
import { EmailChannel } from "./infrastructure/channels/email.adapter";
import { PushChannel } from "./infrastructure/channels/push.adapter";
import { EventConsumerWorker } from "./infrastructure/event-consumer.worker";

const env = loadEnv();

@Module({
  controllers: [NotificationsController],
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
    { provide: EMAIL_CHANNEL, useClass: EmailChannel },
    { provide: PUSH_CHANNEL, useClass: PushChannel },
    NotificationsService,
    DispatchService,
    EventConsumerWorker,
  ],
})
export class NotificationsModule {}
