import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";

export const PAYMENT_APPLICATION_PDF_QUEUE = "payment-application-pdf";

export interface PaymentApplicationPdfJobData {
  tenantId: string;
  actorId: string;
  paymentApplicationId: string;
}

// Producer side of the pay-app PDF pipeline (api.md §10: "POST
// {id}/generate-pdf -> 202"), same Queue/Worker split as ExportsQueue/
// ExportWorker.
@Injectable()
export class PaymentApplicationPdfQueue implements OnModuleDestroy {
  private readonly queue: Queue<PaymentApplicationPdfJobData>;

  constructor(@Inject(QUEUE_CONNECTION) connection: Redis) {
    this.queue = new Queue(PAYMENT_APPLICATION_PDF_QUEUE, { connection });
  }

  async enqueue(data: PaymentApplicationPdfJobData): Promise<void> {
    await this.queue.add("generate-pdf", data, { removeOnComplete: true, removeOnFail: 100 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
