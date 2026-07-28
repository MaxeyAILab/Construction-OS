import type { Database } from "../../src/infrastructure/db/client";
import { createQueueConnection } from "../../src/infrastructure/queue/connection";
import { AccountingConnectionsService } from "../../src/modules/accounting/application/accounting-connections.service";
import { AccountingSyncRunnerService } from "../../src/modules/accounting/application/accounting-sync-runner.service";
import { AccountingSyncQueue } from "../../src/modules/accounting/application/accounting-sync.queue";
import { AccountingSyncService } from "../../src/modules/accounting/application/accounting-sync.service";
import { AccountingOAuthStateService } from "../../src/modules/accounting/infrastructure/oauth-state.service";
import type {
  AccountingAccount,
  AccountingProvider,
  AccountingTokens,
  PushCostTransactionInput,
} from "../../src/modules/accounting/domain/provider";
import type { CostTransactionsService } from "../../src/modules/budgets/application/cost-transactions.service";
import { EncryptionService } from "../../src/modules/auth";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const TEST_STATE_SECRET = "test-accounting-oauth-state-secret-32-bytes-min";

// Test double for the ACCOUNTING_PROVIDER interface — mirrors FakeAiProvider's
// role (test/setup/ai.ts): a real implementation of the interface with no
// network calls, so AccountingConnectionsService/AccountingSyncRunnerService's
// own logic (token storage/refresh, push/pull/conflict detection) is
// exercised without needing a real Intuit sandbox app.
export class FakeAccountingProvider implements AccountingProvider {
  private nextExternalId = 1;
  // externalId -> current remote amount, mutable so tests can simulate a
  // QuickBooks-side edit happening between push and the next verify pass.
  remoteAmounts = new Map<string, string>();
  accounts: AccountingAccount[] = [{ id: "acct-1", name: "Materials Expense", type: "Expense" }];

  getAuthorizationUrl(state: string): string {
    return `https://fake-quickbooks.test/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(_code: string, _redirectUri: string): Promise<AccountingTokens> {
    return { accessToken: "fake-access-token", refreshToken: "fake-refresh-token", expiresInSeconds: 3600 };
  }

  async refreshAccessToken(_refreshToken: string): Promise<AccountingTokens> {
    return { accessToken: "fake-access-token-refreshed", refreshToken: "fake-refresh-token-refreshed", expiresInSeconds: 3600 };
  }

  async listAccounts(_accessToken: string, _realmId: string): Promise<AccountingAccount[]> {
    return this.accounts;
  }

  async pushCostTransaction(
    _accessToken: string,
    _realmId: string,
    input: PushCostTransactionInput,
  ): Promise<{ externalId: string }> {
    const externalId = `qb-txn-${this.nextExternalId++}`;
    this.remoteAmounts.set(externalId, input.amount);
    return { externalId };
  }

  async getTransactionAmount(_accessToken: string, _realmId: string, externalId: string): Promise<string | null> {
    return this.remoteAmounts.get(externalId) ?? null;
  }

  async reassertTransactionAmount(_accessToken: string, _realmId: string, externalId: string, amount: string): Promise<void> {
    this.remoteAmounts.set(externalId, amount);
  }
}

export function buildTestAccountingServices(db: Database, costTransactionsService: CostTransactionsService) {
  const outbox = new OutboxService();
  const encryption = new EncryptionService(TEST_ENCRYPTION_KEY);
  const oauthState = new AccountingOAuthStateService(TEST_STATE_SECRET);
  const provider = new FakeAccountingProvider();
  const connectionsService = new AccountingConnectionsService(db, outbox, encryption, oauthState, provider);

  const queueConnection = createQueueConnection({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const queue = new AccountingSyncQueue(queueConnection);
  const syncRunnerService = new AccountingSyncRunnerService(db, connectionsService, provider, outbox);
  const syncService = new AccountingSyncService(db, connectionsService, queue, costTransactionsService, provider);

  return { connectionsService, syncService, syncRunnerService, provider, queueConnection };
}
