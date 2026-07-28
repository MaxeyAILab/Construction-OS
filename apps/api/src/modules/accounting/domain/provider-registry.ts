import type { AccountingProvider } from "./provider";

// A tenant's accounting_connections row can be any of quickbooks/sage/xero
// (database.md §11's 3-way CHECK) — this resolves the connection's
// `provider` column to the matching AccountingProvider implementation, so
// AccountingConnectionsService/AccountingSyncRunnerService/
// AccountingSyncService never hardcode which one they're talking to.
export class AccountingProviderRegistry {
  private readonly providers = new Map<string, AccountingProvider>();

  register(provider: string, implementation: AccountingProvider): void {
    this.providers.set(provider, implementation);
  }

  resolve(provider: string): AccountingProvider {
    const implementation = this.providers.get(provider);
    if (!implementation) throw new Error(`no accounting provider registered for '${provider}'`);
    return implementation;
  }
}

export const ACCOUNTING_PROVIDER_REGISTRY = Symbol("ACCOUNTING_PROVIDER_REGISTRY");
