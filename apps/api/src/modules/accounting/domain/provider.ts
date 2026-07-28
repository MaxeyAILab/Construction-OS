// architecture.md §7's "provider-agnostic adapter interface, swappable
// without product changes" precedent (AiProvider/StorageService) applied to
// accounting: AccountingSyncRunnerService and AccountingConnectionsService
// only ever depend on this interface, never on a specific provider's SDK/
// API directly. QuickBooksProvider/SageProvider/XeroProvider each implement
// it; AccountingProviderRegistry (provider-registry.ts) resolves the right
// one per connection's `provider` column.

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
  // Sage/Xero post journals that must balance (debit = credit) — this is
  // the contra/clearing account for the balancing line. Ignored by
  // QuickBooks, whose Purchase entity balances implicitly against the
  // payment account. Undefined when the connection's mapping hasn't
  // configured one; providers that need it treat that as "can't push" the
  // same way a missing per-cost-code account mapping is treated (skip, not
  // a hard failure of the whole run).
  clearingAccountId?: string | undefined;
}

export interface AccountingProvider {
  getAuthorizationUrl(state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<AccountingTokens>;
  refreshAccessToken(refreshToken: string): Promise<AccountingTokens>;
  // QuickBooks' OAuth callback carries the realm (company) id directly in
  // the redirect query string; Xero/Sage don't — their callback only
  // carries `code`/`state`, and the connected organization/business id
  // must be resolved via a follow-up authenticated call
  // (GET /connections for Xero, GET /businesses for Sage).
  // QuickBooksProvider's implementation just reads callbackParams.realmId;
  // the others ignore callbackParams and call out to their API.
  resolveRealmId(accessToken: string, callbackParams: { realmId?: string | undefined }): Promise<string>;
  // The chart of accounts — drives the mapping UI (api.md's "mapping" half
  // of the /integrations/accounting/… row).
  listAccounts(accessToken: string, realmId: string): Promise<AccountingAccount[]>;
  pushCostTransaction(
    accessToken: string,
    realmId: string,
    input: PushCostTransactionInput,
  ): Promise<{ externalId: string }>;
  // Null means "no longer exists on the provider side" (deleted) — callers
  // treat that the same as an unreadable divergence, not a crash.
  getTransactionAmount(accessToken: string, realmId: string, externalId: string): Promise<string | null>;
  // Conflict resolution "keep_local": overwrite the provider-side value
  // with ours. A no-op (not an error) if the row was deleted remotely in
  // the meantime — there's nothing left to overwrite.
  reassertTransactionAmount(accessToken: string, realmId: string, externalId: string, amount: string): Promise<void>;
}
