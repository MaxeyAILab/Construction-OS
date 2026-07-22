import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { ObservableResult } from "@opentelemetry/api";
import { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";
import { meter } from "../../../infrastructure/observability/metrics";
import { RelayService } from "../application/relay.service";

export const OUTBOX_RELAY_QUEUE = "outbox-relay";
const REPEATABLE_JOB_NAME = "relay-batch";

// architecture.md §15: "queue depth/DLQ alarms" — an observable gauge
// (rather than a plain counter) since queue depth is a point-in-time
// snapshot the exporter samples on its own interval, not something this
// process increments/decrements as events happen.
const queueDepth = meter.createObservableGauge("outbox_relay_queue_depth", {
  description: "Pending (waiting + delayed) jobs on the outbox-relay BullMQ queue",
});

/**
 * Runs the outbox->NATS relay as a genuine BullMQ repeatable job (roadmap.md
 * requires "BullMQ workers", not an ad-hoc setInterval) — this gets BullMQ's
 * retry/backoff/DLQ handling for free if a relay batch throws.
 */
@Injectable()
export class RelayWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayWorker.name);
  private queue?: Queue;
  private worker?: Worker;
  private readonly reportQueueDepth = async (result: ObservableResult): Promise<void> => {
    if (!this.queue) return;
    const [waiting, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getDelayedCount(),
    ]);
    result.observe(waiting + delayed);
  };

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly relayService: RelayService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(OUTBOX_RELAY_QUEUE, { connection: this.connection });
    await this.queue.add(
      REPEATABLE_JOB_NAME,
      {},
      {
        repeat: { every: 2000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    this.worker = new Worker(OUTBOX_RELAY_QUEUE, async () => this.relayService.relayBatch(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`relay job ${job?.id ?? "?"} failed: ${err.message}`);
    });

    queueDepth.addCallback(this.reportQueueDepth);
  }

  async onModuleDestroy(): Promise<void> {
    queueDepth.removeCallback(this.reportQueueDepth);
    await this.worker?.close();
    await this.queue?.close();
  }
}
