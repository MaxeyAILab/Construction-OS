import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";

export const FILE_PROCESSING_QUEUE = "file-processing";

export interface FileProcessingJobData {
  fileId: string;
  tenantId: string;
}

/**
 * The producer side of the file-processing pipeline: FileUploadService
 * enqueues one job per completed upload here; FileProcessingWorker
 * (infrastructure/file-processing.worker.ts) is the consumer. Split from
 * the worker itself so the upload-completion code path doesn't need to
 * depend on BullMQ's Worker/consumer machinery, only its producer API.
 */
@Injectable()
export class FileProcessingQueue implements OnModuleDestroy {
  private readonly queue: Queue<FileProcessingJobData>;

  constructor(@Inject(QUEUE_CONNECTION) connection: Redis) {
    this.queue = new Queue(FILE_PROCESSING_QUEUE, { connection });
  }

  async enqueue(data: FileProcessingJobData): Promise<void> {
    await this.queue.add("process-file", data, { removeOnComplete: true, removeOnFail: 100 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
