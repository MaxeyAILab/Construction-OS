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
import { ExecutiveBriefingAgentRunnerService } from "../application/executive-briefing-agent-runner.service";

export const EXECUTIVE_BRIEFING_AGENT_QUEUE = "executive-briefing-agent-tick";
const REPEATABLE_JOB_NAME = "weekly-tick";

// api.md §15.6: the Executive Briefing Agent's weekly tick, driven as a
// genuine BullMQ repeatable job — same Queue/Worker split as every other
// agent worker in this module, a weekly (not daily/monthly) cron pattern
// matching ai-spec.md §7.1's own "weekly proactive briefing" cadence.
@Injectable()
export class ExecutiveBriefingAgentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExecutiveBriefingAgentWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: ExecutiveBriefingAgentRunnerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(EXECUTIVE_BRIEFING_AGENT_QUEUE, { connection: this.connection });
    await this.queue.add(
      REPEATABLE_JOB_NAME,
      {},
      {
        repeat: { pattern: "0 0 * * 1" }, // weekly, Monday 00:00 UTC
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    this.worker = new Worker(EXECUTIVE_BRIEFING_AGENT_QUEUE, async () => this.runner.runTick(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`executive briefing agent tick job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
