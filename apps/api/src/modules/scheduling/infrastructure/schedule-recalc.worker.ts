import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";
import { RecalculateService } from "../application/recalculate.service";
import { SCHEDULE_RECALC_QUEUE, type ScheduleRecalcJobData } from "../application/recalculate.queue";

// BullMQ consumer side of the >=500-activity CPM recalc path — thin wiring
// only, matching FileProcessingWorker/RelayWorker's split.
@Injectable()
export class ScheduleRecalcWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleRecalcWorker.name);
  private worker?: Worker<ScheduleRecalcJobData>;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly recalculate: RecalculateService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ScheduleRecalcJobData>(
      SCHEDULE_RECALC_QUEUE,
      async (job: Job<ScheduleRecalcJobData>) =>
        this.recalculate.recalculateSync(job.data.tenantId, job.data.actorId, job.data.scheduleId),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`schedule recalculate job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
