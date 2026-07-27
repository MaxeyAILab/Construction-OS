import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";
import { ReportRunnerService } from "../application/report-runner.service";
import { REPORT_QUEUE, type ReportJobData } from "../application/reports.queue";

// BullMQ consumer side — thin wiring only, matching PaymentApplicationPdfWorker's split.
@Injectable()
export class ReportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportWorker.name);
  private worker?: Worker<ReportJobData>;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: ReportRunnerService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ReportJobData>(
      REPORT_QUEUE,
      async (job: Job<ReportJobData>) => this.runner.run(job.data),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`report job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
