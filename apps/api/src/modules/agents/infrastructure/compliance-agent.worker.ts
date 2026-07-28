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
import { ComplianceAgentRunnerService } from "../application/compliance-agent-runner.service";

export const COMPLIANCE_AGENT_QUEUE = "compliance-agent-tick";
const REPEATABLE_JOB_NAME = "daily-tick";

// api.md §15.4: the Compliance Agent's daily tick, driven as a genuine
// BullMQ repeatable job — same Queue/Worker split and daily cron pattern
// as ProcurementAgentWorker (§15.2); cert expiry is date-driven, so daily
// freshness matters the way §15.3's monthly cadence wouldn't.
@Injectable()
export class ComplianceAgentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ComplianceAgentWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: ComplianceAgentRunnerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(COMPLIANCE_AGENT_QUEUE, { connection: this.connection });
    await this.queue.add(
      REPEATABLE_JOB_NAME,
      {},
      {
        repeat: { pattern: "0 0 * * *" }, // daily at 00:00 UTC
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    this.worker = new Worker(COMPLIANCE_AGENT_QUEUE, async () => this.runner.runTick(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`compliance agent tick job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
