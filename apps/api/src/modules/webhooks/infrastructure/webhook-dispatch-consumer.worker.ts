import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { outboxEnvelopeSchema } from "@constructionos/schemas";
import { AckPolicy, DeliverPolicy, type ConsumerMessages, JSONCodec, type NatsConnection } from "nats";
import { recordConsumed, recordDeadLettered } from "../../../infrastructure/observability/consumer-metrics";
import { EVENTS_STREAM_NAME, NATS_CONNECTION } from "../../../infrastructure/nats/client";
import { WebhookDispatchService } from "../application/webhook-dispatch.service";

const DURABLE_NAME = "webhook-dispatcher";
// api.md §16.3: "exponential retries 24 h -> dead-letter". 15 attempts at
// min(2^n * 1s, 1h) backoff spans ~24h before giving up, same order of
// magnitude as the spec's window without hardcoding a wall-clock deadline
// that would fight JetStream's own delivery-count tracking.
const MAX_DELIVERY_ATTEMPTS = 15;
const jsonCodec = JSONCodec();

// architecture.md §4.2/§8: "webhook dispatcher" is named alongside audit and
// notifications as a generic all-events JetStream consumer — this worker
// mirrors AuditConsumerWorker's exact durable-consumer/consume-loop shape,
// with its own durable name so a slow or restarting webhook fan-out never
// affects the audit or notification pipelines (or vice versa).
@Injectable()
export class WebhookDispatchConsumerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatchConsumerWorker.name);
  private messages?: ConsumerMessages;
  private loopPromise?: Promise<void>;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly dispatch: WebhookDispatchService,
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
      const isFinalAttempt = msg.info.deliveryCount >= MAX_DELIVERY_ATTEMPTS;
      try {
        const envelope = outboxEnvelopeSchema.parse(jsonCodec.decode(msg.data));
        // deliverToEndpoint never throws on an individual endpoint's HTTP
        // failure (it logs a webhook_deliveries row and returns ok:false) —
        // the dead-letter event itself is only emitted inside dispatchEnvelope
        // when isFinalAttempt is true, so here we only need to decide
        // ack-vs-nak based on whether any endpoint still needs a retry.
        const results = await this.dispatch.dispatchEnvelope(envelope, { isFinalAttempt });
        const anyFailed = results.some((r) => !r.ok);

        if (anyFailed && !isFinalAttempt) {
          const delay = Math.min(2 ** msg.info.deliveryCount * 1000, 3_600_000);
          msg.nak(delay);
          recordConsumed(DURABLE_NAME, msg.subject, "nak");
        } else {
          msg.ack();
          recordConsumed(DURABLE_NAME, msg.subject, "ack");
          if (anyFailed) recordDeadLettered(DURABLE_NAME, msg.subject);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isFinalAttempt) {
          this.logger.error(`giving up on ${msg.subject} after ${msg.info.deliveryCount} attempts: ${message}`);
          msg.ack();
          recordDeadLettered(DURABLE_NAME, msg.subject);
        } else {
          const delay = Math.min(2 ** msg.info.deliveryCount * 1000, 3_600_000);
          this.logger.error(`failed to dispatch ${msg.subject} (attempt ${msg.info.deliveryCount}): ${message}`);
          msg.nak(delay);
          recordConsumed(DURABLE_NAME, msg.subject, "nak");
        }
      }
    }
  }
}
