import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";
import { ProcurementAgentRunnerService } from "../application/procurement-agent-runner.service";

export const PROCUREMENT_AGENT_QUEUE = "procurement-agent-tick";
const REPEATABLE_JOB_NAME = "daily-tick";

// api.md §15.2: the Procurement Agent's daily tick, driven as a genuine
// BullMQ repeatable job — same "get retry/backoff/DLQ handling for free"
// reasoning and Queue/Worker split as RelayWorker (the outbox->NATS
// relay), just on a cron pattern instead of a fixed interval since this
// is a once-a-day pass, not a continuous drain.
@Injectable()
export class ProcurementAgentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcurementAgentWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: ProcurementAgentRunnerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(PROCUREMENT_AGENT_QUEUE, { connection: this.connection });
    await this.queue.add(
      REPEATABLE_JOB_NAME,
      {},
      {
        repeat: { pattern: "0 0 * * *" }, // daily at 00:00 UTC
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    this.worker = new Worker(PROCUREMENT_AGENT_QUEUE, async () => this.runner.runTick(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`procurement agent tick job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
