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
import { PaymentApplicationPdfRunnerService } from "../application/payment-application-pdf-runner.service";
import { PAYMENT_APPLICATION_PDF_QUEUE, type PaymentApplicationPdfJobData } from "../application/payment-application-pdf.queue";

// BullMQ consumer side — thin wiring only, matching ExportWorker's split.
@Injectable()
export class PaymentApplicationPdfWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentApplicationPdfWorker.name);
  private worker?: Worker<PaymentApplicationPdfJobData>;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly runner: PaymentApplicationPdfRunnerService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<PaymentApplicationPdfJobData>(
      PAYMENT_APPLICATION_PDF_QUEUE,
      async (job: Job<PaymentApplicationPdfJobData>) => this.runner.run(job.data),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`payment application pdf job ${job?.id ?? "?"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
