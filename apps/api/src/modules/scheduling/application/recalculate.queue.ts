import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";

export const SCHEDULE_RECALC_QUEUE = "schedule-recalculate";

export interface ScheduleRecalcJobData {
  tenantId: string;
  actorId: string;
  scheduleId: string;
}

// database.md §14: "CPM recalculation runs in a worker for schedules > 500
// activities (job queue), synchronously below that." Producer side, split
// from the worker itself — same FileProcessingQueue/Worker split as the
// Files module.
@Injectable()
export class ScheduleRecalcQueue implements OnModuleDestroy {
  private readonly queue: Queue<ScheduleRecalcJobData>;

  constructor(@Inject(QUEUE_CONNECTION) connection: Redis) {
    this.queue = new Queue(SCHEDULE_RECALC_QUEUE, { connection });
  }

  async enqueue(data: ScheduleRecalcJobData): Promise<string> {
    const job = await this.queue.add("recalculate", data, { removeOnComplete: true, removeOnFail: 100 });
    return job.id!;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
