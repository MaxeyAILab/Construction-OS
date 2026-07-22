import type { NatsConnection } from "nats";
import type { Database } from "../../src/infrastructure/db/client";
import { createNatsConnection, ensureEventStream } from "../../src/infrastructure/nats/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { RelayService } from "../../src/modules/events/application/relay.service";

export async function buildTestEventsServices(db: Database): Promise<{
  outboxService: OutboxService;
  relayService: RelayService;
  nc: NatsConnection;
}> {
  const nc = await createNatsConnection({
    NATS_URL: process.env.NATS_URL ?? "nats://localhost:4222",
  });
  await ensureEventStream(nc);

  return {
    outboxService: new OutboxService(),
    relayService: new RelayService(db, nc),
    nc,
  };
}
