import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";
import { AccountingSyncRunnerService } from "../application/accounting-sync-runner.service";
import { ACCOUNTING_SYNC_QUEUE, type AccountingSyncJobData } from "../application/accounting-sync.queue";

// BullMQ consumer side — thin wiring only, matching ReportWorker's split.
@Injectable()
export class AccountingSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountingSyncWorker.name);
  private worker?: Worker<AccountingSyncJobData>;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: AccountingSyncRunnerService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AccountingSyncJobData>(
      ACCOUNTING_SYNC_QUEUE,
      async (job: Job<AccountingSyncJobData>) => this.runner.run(job.data),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`accounting sync job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
