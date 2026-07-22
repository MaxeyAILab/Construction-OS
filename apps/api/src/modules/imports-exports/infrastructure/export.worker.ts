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
import { ExportRunnerService } from "../application/export-runner.service";
import { EXPORT_QUEUE, type ExportJobData } from "../application/exports.queue";

// BullMQ consumer side — thin wiring only, matching FileProcessingWorker/
// RelayWorker's split.
@Injectable()
export class ExportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportWorker.name);
  private worker?: Worker<ExportJobData>;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: ExportRunnerService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ExportJobData>(
      EXPORT_QUEUE,
      async (job: Job<ExportJobData>) => this.runner.run(job.data),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`export job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
