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
import { AccountingProviderRegistry } from "../../src/modules/accounting/domain/provider-registry";
import type { CostTransactionsService } from "../../src/modules/budgets/application/cost-transactions.service";
import { EncryptionService } from "../../src/modules/auth";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const TEST_STATE_SECRET = "test-accounting-oauth-state-secret-32-bytes-min";

// Test double for the AccountingProvider interface — mirrors FakeAiProvider's
// role (test/setup/ai.ts): a real implementation of the interface with no
// network calls, so AccountingConnectionsService/AccountingSyncRunnerService's
// own logic (token storage/refresh, push/pull/conflict detection, per-
// provider realm resolution) is exercised without needing real QuickBooks/
// Sage/Xero developer apps. One instance per provider name — proves the
// registry actually routes to the right one, not just that "a" provider
// works generically.
export class FakeAccountingProvider implements AccountingProvider {
  private nextExternalId = 1;
  // externalId -> current remote amount, mutable so tests can simulate a
  // provider-side edit happening between push and the next verify pass.
  remoteAmounts = new Map<string, string>();
  // externalId -> clearingAccountId it was pushed with, so tests can prove
  // the runner actually threads mapping.defaultClearingAccountId through
  // to the provider for Sage/Xero-style double-entry pushes.
  lastClearingAccountId: string | undefined;
  accounts: AccountingAccount[] = [
    { id: "acct-1", name: "Materials Expense", type: "Expense" },
    { id: "acct-clearing", name: "Sync Clearing", type: "Bank" },
  ];

  constructor(private readonly label: string) {}

  getAuthorizationUrl(state: string): string {
    return `https://fake-${this.label}.test/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(_code: string, _redirectUri: string): Promise<AccountingTokens> {
    return { accessToken: `fake-${this.label}-access-token`, refreshToken: `fake-${this.label}-refresh-token`, expiresInSeconds: 3600 };
  }

  async refreshAccessToken(_refreshToken: string): Promise<AccountingTokens> {
    return {
      accessToken: `fake-${this.label}-access-token-refreshed`,
      refreshToken: `fake-${this.label}-refresh-token-refreshed`,
      expiresInSeconds: 3600,
    };
  }

  // QuickBooks-style callers pass realmId in the callback; Sage/Xero-style
  // callers don't, so this falls back to resolving one itself — same
  // "callback carries it vs. resolve via API" split as the real adapters.
  async resolveRealmId(_accessToken: string, callbackParams: { realmId?: string | undefined }): Promise<string> {
    return callbackParams.realmId ?? `fake-${this.label}-realm-1`;
  }

  async listAccounts(_accessToken: string, _realmId: string): Promise<AccountingAccount[]> {
    return this.accounts;
  }

  async pushCostTransaction(
    _accessToken: string,
    _realmId: string,
    input: PushCostTransactionInput,
  ): Promise<{ externalId: string }> {
    const externalId = `${this.label}-txn-${this.nextExternalId++}`;
    this.remoteAmounts.set(externalId, input.amount);
    this.lastClearingAccountId = input.clearingAccountId;
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

  const quickbooksProvider = new FakeAccountingProvider("quickbooks");
  const sageProvider = new FakeAccountingProvider("sage");
  const xeroProvider = new FakeAccountingProvider("xero");
  const providers = new AccountingProviderRegistry();
  providers.register("quickbooks", quickbooksProvider);
  providers.register("sage", sageProvider);
  providers.register("xero", xeroProvider);

  const connectionsService = new AccountingConnectionsService(db, outbox, encryption, oauthState, providers);

  const queueConnection = createQueueConnection({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const queue = new AccountingSyncQueue(queueConnection);
  const syncRunnerService = new AccountingSyncRunnerService(db, connectionsService, providers, outbox);
  const syncService = new AccountingSyncService(db, connectionsService, queue, costTransactionsService, providers);

  return {
    connectionsService,
    syncService,
    syncRunnerService,
    providers: { quickbooks: quickbooksProvider, sage: sageProvider, xero: xeroProvider },
    queueConnection,
  };
}
