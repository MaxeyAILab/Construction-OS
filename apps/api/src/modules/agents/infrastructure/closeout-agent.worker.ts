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
import { CloseoutAgentRunnerService } from "../application/closeout-agent-runner.service";

export const CLOSEOUT_AGENT_QUEUE = "closeout-agent-tick";
const REPEATABLE_JOB_NAME = "daily-tick";

// api.md §15.5: the Closeout Agent's daily tick, driven as a genuine
// BullMQ repeatable job — same Queue/Worker split and daily cron pattern
// as ComplianceAgentWorker (§15.4); there's no event to react to (a
// checklist/punch item reaching its final state doesn't itself signal
// "the project might be closeout-ready now"), so a periodic sweep is the
// simplest correct trigger.
@Injectable()
export class CloseoutAgentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CloseoutAgentWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: CloseoutAgentRunnerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(CLOSEOUT_AGENT_QUEUE, { connection: this.connection });
    await this.queue.add(
      REPEATABLE_JOB_NAME,
      {},
      {
        repeat: { pattern: "0 0 * * *" }, // daily at 00:00 UTC
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    this.worker = new Worker(CLOSEOUT_AGENT_QUEUE, async () => this.runner.runTick(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`closeout agent tick job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
