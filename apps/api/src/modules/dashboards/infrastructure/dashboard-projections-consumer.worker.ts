import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { outboxEnvelopeSchema } from "@constructionos/schemas";
import {
  AckPolicy,
  DeliverPolicy,
  type ConsumerMessages,
  JSONCodec,
  type NatsConnection,
} from "nats";
import { recordConsumed, recordDeadLettered } from "../../../infrastructure/observability/consumer-metrics";
import { EVENTS_STREAM_NAME, NATS_CONNECTION } from "../../../infrastructure/nats/client";
import { DashboardProjectionsWriterService } from "../application/dashboard-projections-writer.service";

const DURABLE_NAME = "dashboard-projections-writer";
const MAX_DELIVERY_ATTEMPTS = 5;
const jsonCodec = JSONCodec();

// database.md §21: "rebuilt from events" — a durable JetStream pull
// consumer with its own durable name, independent of audit's/notifications'
// own consumers, same "each fans out independently, one falling behind
// never affects the others" reasoning as AuditConsumerWorker.
@Injectable()
export class DashboardProjectionsConsumerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DashboardProjectionsConsumerWorker.name);
  private messages?: ConsumerMessages;
  private loopPromise?: Promise<void>;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly writer: DashboardProjectionsWriterService,
  ) {}

  async onModuleInit(): Promise<void> {
    const jsm = await this.nc.jetstreamManager();
    try {
      await jsm.consumers.info(EVENTS_STREAM_NAME, DURABLE_NAME);
    } catch {
      await jsm.consumers.add(EVENTS_STREAM_NAME, {
        durable_name: DURABLE_NAME,
        filter_subject: "events.>",
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
      });
    }

    const js = this.nc.jetstream();
    const consumer = await js.consumers.get(EVENTS_STREAM_NAME, DURABLE_NAME);
    this.messages = await consumer.consume({ max_messages: 10 });
    this.loopPromise = this.consumeLoop(this.messages);
  }

  async onModuleDestroy(): Promise<void> {
    await this.messages?.close();
    await this.loopPromise;
  }

  private async consumeLoop(messages: ConsumerMessages): Promise<void> {
    for await (const msg of messages) {
      try {
        const envelope = outboxEnvelopeSchema.parse(jsonCodec.decode(msg.data));
        await this.writer.handleEnvelope(envelope);
        msg.ack();
        recordConsumed(DURABLE_NAME, msg.subject, "ack");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (msg.info.deliveryCount >= MAX_DELIVERY_ATTEMPTS) {
          this.logger.error(
            `giving up on ${msg.subject} after ${msg.info.deliveryCount} attempts, dead-lettering: ${message}`,
          );
          msg.ack();
          recordDeadLettered(DURABLE_NAME, msg.subject);
        } else {
          this.logger.error(
            `failed to process ${msg.subject} (attempt ${msg.info.deliveryCount}): ${message}`,
          );
          msg.nak(2000);
          recordConsumed(DURABLE_NAME, msg.subject, "nak");
        }
      }
    }
  }
}
