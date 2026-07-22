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
import {
  FILE_PROCESSING_QUEUE,
  type FileProcessingJobData,
} from "../application/file-processing.queue";
import { FileProcessingService } from "../application/file-processing.service";

/**
 * BullMQ consumer side of the file-processing pipeline — thin wiring only,
 * matching RelayWorker/RelayService's split. Each upload gets one ad-hoc
 * job (FileProcessingQueue.enqueue), not a repeatable poll, since
 * processing is triggered by a specific upload completing, not on a timer.
 */
@Injectable()
export class FileProcessingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileProcessingWorker.name);
  private worker?: Worker<FileProcessingJobData>;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly processing: FileProcessingService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<FileProcessingJobData>(
      FILE_PROCESSING_QUEUE,
      async (job: Job<FileProcessingJobData>) => this.processing.process(job.data),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`file processing job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
