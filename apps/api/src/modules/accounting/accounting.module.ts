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
import { ACCOUNTING_PROVIDER_REGISTRY, AccountingProviderRegistry } from "./domain/provider-registry";
import { AccountingOAuthStateService } from "./infrastructure/oauth-state.service";
import { AccountingSyncWorker } from "./infrastructure/accounting-sync.worker";
import { QuickBooksProvider } from "./infrastructure/quickbooks-provider";
import { SageProvider } from "./infrastructure/sage-provider";
import { XeroProvider } from "./infrastructure/xero-provider";

const env = loadEnv();

@Module({
  imports: [EventsModule, BudgetsModule],
  controllers: [AccountingController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: QUEUE_CONNECTION, useFactory: () => createQueueConnection(env) },
    { provide: EncryptionService, useFactory: () => new EncryptionService(env.ACCOUNTING_ENCRYPTION_KEY) },
    { provide: AccountingOAuthStateService, useFactory: () => new AccountingOAuthStateService(env.ACCOUNTING_OAUTH_STATE_SECRET) },
    // roadmap.md "Sage & Xero connectors" — all three register into the
    // same AccountingProviderRegistry; a connection row's `provider`
    // column (not this module) decides which one a given tenant actually
    // talks to.
    {
      provide: ACCOUNTING_PROVIDER_REGISTRY,
      useFactory: () => {
        const registry = new AccountingProviderRegistry();
        registry.register(
          "quickbooks",
          new QuickBooksProvider({
            clientId: env.QUICKBOOKS_CLIENT_ID ?? "",
            clientSecret: env.QUICKBOOKS_CLIENT_SECRET ?? "",
            redirectUri: env.QUICKBOOKS_REDIRECT_URI ?? "",
            environment: env.QUICKBOOKS_ENVIRONMENT,
          }),
        );
        registry.register(
          "sage",
          new SageProvider({
            clientId: env.SAGE_CLIENT_ID ?? "",
            clientSecret: env.SAGE_CLIENT_SECRET ?? "",
            redirectUri: env.SAGE_REDIRECT_URI ?? "",
          }),
        );
        registry.register(
          "xero",
          new XeroProvider({
            clientId: env.XERO_CLIENT_ID ?? "",
            clientSecret: env.XERO_CLIENT_SECRET ?? "",
            redirectUri: env.XERO_REDIRECT_URI ?? "",
          }),
        );
        return registry;
      },
    },
    AccountingConnectionsService,
    AccountingSyncQueue,
    AccountingSyncRunnerService,
    AccountingSyncWorker,
    AccountingSyncService,
  ],
})
export class AccountingModule {}
