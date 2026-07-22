import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ExportEntityType } from "@constructionos/schemas";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";

export const EXPORT_QUEUE = "data-export";

export interface ExportJobData {
  tenantId: string;
  actorId: string;
  exportJobId: string;
  entityType: ExportEntityType;
}

// Producer side of the export pipeline (architecture.md §9: "queues = units
// of work... report render, import, accounting sync"), same Queue/Worker
// split as ScheduleRecalcQueue/FileProcessingQueue.
@Injectable()
export class ExportsQueue implements OnModuleDestroy {
  private readonly queue: Queue<ExportJobData>;

  constructor(@Inject(QUEUE_CONNECTION) connection: Redis) {
    this.queue = new Queue(EXPORT_QUEUE, { connection });
  }

  async enqueue(data: ExportJobData): Promise<void> {
    await this.queue.add("run-export", data, { removeOnComplete: true, removeOnFail: 100 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
