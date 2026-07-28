// architecture.md §7's "provider-agnostic adapter interface, swappable
// without product changes" precedent (AiProvider/StorageService) applied to
// accounting: AccountingSyncRunnerService and AccountingConnectionsService
// only ever depend on this interface, never on the QuickBooks SDK/API
// directly. QuickBooksProvider is the only real implementation today,
// injected via the ACCOUNTING_PROVIDER token the same way AI_PROVIDER is
// swappable in the ai module.

export interface AccountingTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface AccountingAccount {
  id: string;
  name: string;
  type: string;
}

export interface PushCostTransactionInput {
  externalAccountId: string;
  amount: string;
  memo: string | null;
  date: string;
  docNumber: string;
}

export interface AccountingProvider {
  getAuthorizationUrl(state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<AccountingTokens>;
  refreshAccessToken(refreshToken: string): Promise<AccountingTokens>;
  // The chart of accounts — drives the mapping UI (api.md's "mapping" half
  // of the /integrations/accounting/… row).
  listAccounts(accessToken: string, realmId: string): Promise<AccountingAccount[]>;
  pushCostTransaction(
    accessToken: string,
    realmId: string,
    input: PushCostTransactionInput,
  ): Promise<{ externalId: string }>;
  // Null means "no longer exists on the QuickBooks side" (deleted) — callers
  // treat that the same as an unreadable divergence, not a crash.
  getTransactionAmount(accessToken: string, realmId: string, externalId: string): Promise<string | null>;
  // Conflict resolution "keep_local": overwrite the QuickBooks-side value
  // with ours. A no-op (not an error) if the row was deleted remotely in
  // the meantime — there's nothing left to overwrite.
  reassertTransactionAmount(accessToken: string, realmId: string, externalId: string, amount: string): Promise<void>;
}

export const ACCOUNTING_PROVIDER = Symbol("ACCOUNTING_PROVIDER");
