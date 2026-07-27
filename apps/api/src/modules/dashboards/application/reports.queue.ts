import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";

export const REPORT_QUEUE = "report-run";

export interface ReportJobData {
  tenantId: string;
  actorId: string;
  reportDefinitionId: string;
  reportRunId: string;
}

// Producer side of the report-run pipeline (api.md §14: "POST
// /reports/definitions/{id}/run -> 202 -> job -> artifact"), same
// Queue/Worker split as PaymentApplicationPdfQueue/Worker. Only IDs travel
// through the job — ReportRunnerService re-fetches the definition fresh
// from the DB, same "don't trust job-payload content, re-derive it"
// precedent as the payment-app PDF pipeline.
@Injectable()
export class ReportsQueue implements OnModuleDestroy {
  private readonly queue: Queue<ReportJobData>;

  constructor(@Inject(QUEUE_CONNECTION) connection: Redis) {
    this.queue = new Queue(REPORT_QUEUE, { connection });
  }

  async enqueue(data: ReportJobData): Promise<void> {
    await this.queue.add("run-report", data, { removeOnComplete: true, removeOnFail: 100 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
