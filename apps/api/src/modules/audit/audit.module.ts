import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import {
  createNatsConnection,
  ensureEventStream,
  NATS_CONNECTION,
} from "../../infrastructure/nats/client";
import { AuditController } from "./api/audit.controller";
import { AuditQueryService } from "./application/audit-query.service";
import { AuditWriterService } from "./application/audit-writer.service";
import { AuditConsumerWorker } from "./infrastructure/audit-consumer.worker";

const env = loadEnv();

@Module({
  controllers: [AuditController],
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
    AuditQueryService,
    AuditWriterService,
    AuditConsumerWorker,
  ],
})
export class AuditModule {}
