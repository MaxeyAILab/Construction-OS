import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_CONNECTION } from "../../../infrastructure/queue/connection";

export const ACCOUNTING_SYNC_QUEUE = "accounting-sync-run";

export interface AccountingSyncJobData {
  tenantId: string;
  actorId: string;
  connectionId: string;
  syncRunId: string;
}

// Producer side of the sync-run pipeline (api.md §10's "sync runs"), same
// Queue/Worker split as ReportsQueue/ReportWorker. Only IDs travel through
// the job — AccountingSyncRunnerService re-fetches the connection fresh
// from the DB, same "don't trust job-payload content" precedent.
@Injectable()
export class AccountingSyncQueue implements OnModuleDestroy {
  private readonly queue: Queue<AccountingSyncJobData>;

  constructor(@Inject(QUEUE_CONNECTION) connection: Redis) {
    this.queue = new Queue(ACCOUNTING_SYNC_QUEUE, { connection });
  }

  async enqueue(data: AccountingSyncJobData): Promise<void> {
    await this.queue.add("run-sync", data, { removeOnComplete: true, removeOnFail: 100 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
