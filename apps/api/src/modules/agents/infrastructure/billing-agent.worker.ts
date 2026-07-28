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
import { BillingAgentRunnerService } from "../application/billing-agent-runner.service";

export const BILLING_AGENT_QUEUE = "billing-agent-tick";
const REPEATABLE_JOB_NAME = "monthly-tick";

// api.md §15.3: the Billing Agent's monthly tick, driven as a genuine
// BullMQ repeatable job — same Queue/Worker split as
// ProcurementAgentWorker (§15.2), just a monthly cron pattern instead of
// a daily one since pay-app assembly is a once-a-month pass.
@Injectable()
export class BillingAgentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingAgentWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: BillingAgentRunnerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(BILLING_AGENT_QUEUE, { connection: this.connection });
    await this.queue.add(
      REPEATABLE_JOB_NAME,
      {},
      {
        repeat: { pattern: "0 0 1 * *" }, // monthly, 00:00 UTC on the 1st
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    this.worker = new Worker(BILLING_AGENT_QUEUE, async () => this.runner.runTick(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`billing agent tick job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
