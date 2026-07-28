import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createQueueConnection, QUEUE_CONNECTION } from "../../infrastructure/queue/connection";
import { EncryptionService } from "../auth";
import { BudgetsModule } from "../budgets";
import { EventsModule } from "../events";
import { AccountingController } from "./api/accounting.controller";
import { AccountingConnectionsService } from "./application/accounting-connections.service";
import { AccountingSyncRunnerService } from "./application/accounting-sync-runner.service";
import { AccountingSyncQueue } from "./application/accounting-sync.queue";
import { AccountingSyncService } from "./application/accounting-sync.service";
import { ACCOUNTING_PROVIDER } from "./domain/provider";
import { AccountingOAuthStateService } from "./infrastructure/oauth-state.service";
import { AccountingSyncWorker } from "./infrastructure/accounting-sync.worker";
import { QuickBooksProvider } from "./infrastructure/quickbooks-provider";

const env = loadEnv();

@Module({
  imports: [EventsModule, BudgetsModule],
  controllers: [AccountingController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: QUEUE_CONNECTION, useFactory: () => createQueueConnection(env) },
    { provide: EncryptionService, useFactory: () => new EncryptionService(env.ACCOUNTING_ENCRYPTION_KEY) },
    { provide: AccountingOAuthStateService, useFactory: () => new AccountingOAuthStateService(env.ACCOUNTING_OAUTH_STATE_SECRET) },
    {
      provide: ACCOUNTING_PROVIDER,
      useFactory: () =>
        new QuickBooksProvider({
          clientId: env.QUICKBOOKS_CLIENT_ID ?? "",
          clientSecret: env.QUICKBOOKS_CLIENT_SECRET ?? "",
          redirectUri: env.QUICKBOOKS_REDIRECT_URI ?? "",
          environment: env.QUICKBOOKS_ENVIRONMENT,
        }),
    },
    AccountingConnectionsService,
    AccountingSyncQueue,
    AccountingSyncRunnerService,
    AccountingSyncWorker,
    AccountingSyncService,
  ],
})
export class AccountingModule {}
