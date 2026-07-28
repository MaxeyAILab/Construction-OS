import { Injectable, Logger } from "@nestjs/common";
import type {
  AccountingAccount,
  AccountingProvider,
  AccountingTokens,
  PushCostTransactionInput,
} from "../domain/provider";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

interface QuickBooksConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox" | "production";
}

// Real Intuit QuickBooks Online adapter (FR-PLAT-8). Getting an Intuit
// developer account and sandbox/production API access costs nothing —
// Intuit doesn't charge for API usage; the only real costs are engineering
// time (this file) and the app-review turnaround for a Production key,
// neither a per-request fee. No live sandbox is provisioned in this
// environment (no QUICKBOOKS_CLIENT_ID/SECRET set — same "optional, dialed
// lazily" precedent as ANTHROPIC_API_KEY), so the exact QBO v3 payload
// shapes below should be validated against a real Intuit sandbox company
// before production use; FakeAccountingProvider (test/setup/accounting.ts)
// is what every test in this codebase actually exercises.
@Injectable()
export class QuickBooksProvider implements AccountingProvider {
  private readonly logger = new Logger(QuickBooksProvider.name);

  constructor(private readonly config: QuickBooksConfig) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: SCOPE,
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<AccountingTokens> {
    return this.requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  }

  async refreshAccessToken(refreshToken: string): Promise<AccountingTokens> {
    return this.requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async listAccounts(accessToken: string, realmId: string): Promise<AccountingAccount[]> {
    const body = (await this.apiGet(accessToken, realmId, "select * from Account")) as {
      QueryResponse?: { Account?: Array<{ Id: string; Name: string; AccountType: string }> };
    };
    const rows = body.QueryResponse?.Account ?? [];
    return rows.map((a) => ({ id: a.Id, name: a.Name, type: a.AccountType }));
  }

  // Posted as a QuickBooks "Purchase" (expense) categorized to the mapped
  // account — the closest QBO entity to a bare cost-code ledger line with
  // no vendor/customer identity attached.
  async pushCostTransaction(
    accessToken: string,
    realmId: string,
    input: PushCostTransactionInput,
  ): Promise<{ externalId: string }> {
    const payload = {
      PaymentType: "Cash",
      TxnDate: input.date,
      DocNumber: input.docNumber,
      PrivateNote: input.memo ?? undefined,
      Line: [
        {
          Amount: Number(input.amount),
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: input.externalAccountId } },
        },
      ],
    };
    const body = (await this.apiPost(accessToken, realmId, "purchase", payload)) as {
      Purchase: { Id: string };
    };
    return { externalId: body.Purchase.Id };
  }

  async getTransactionAmount(accessToken: string, realmId: string, externalId: string): Promise<string | null> {
    const purchase = await this.fetchPurchase(accessToken, realmId, externalId);
    return purchase ? purchase.TotalAmt.toFixed(2) : null;
  }

  // QBO updates are sparse and require the object's current SyncToken
  // (optimistic concurrency) — fetch-then-update, same two-step shape any
  // QBO write-after-read requires. A no-op if the object no longer exists.
  async reassertTransactionAmount(accessToken: string, realmId: string, externalId: string, amount: string): Promise<void> {
    const purchase = await this.fetchPurchase(accessToken, realmId, externalId);
    if (!purchase) return;

    const line = purchase.Line?.[0];
    const payload = {
      Id: externalId,
      SyncToken: purchase.SyncToken,
      sparse: true,
      Line: line
        ? [{ ...line, Amount: Number(amount) }]
        : [{ Amount: Number(amount), DetailType: "AccountBasedExpenseLineDetail" }],
    };
    await this.apiPost(accessToken, realmId, "purchase", payload);
  }

  private async fetchPurchase(
    accessToken: string,
    realmId: string,
    externalId: string,
  ): Promise<{ TotalAmt: number; SyncToken: string; Line?: unknown[] } | null> {
    try {
      const body = (await this.apiGet(accessToken, realmId, undefined, `purchase/${externalId}`)) as {
        Purchase: { TotalAmt: number; SyncToken: string; Line?: unknown[] };
      };
      return body.Purchase;
    } catch (err) {
      this.logger.warn(`quickbooks purchase ${externalId} unreadable: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private apiBase(): string {
    return this.config.environment === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
  }

  private async apiGet(accessToken: string, realmId: string, query?: string, path?: string): Promise<unknown> {
    const url = query
      ? `${this.apiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`
      : `${this.apiBase()}/v3/company/${realmId}/${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`quickbooks GET ${path ?? "query"} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async apiPost(accessToken: string, realmId: string, path: string, payload: unknown): Promise<unknown> {
    const res = await fetch(`${this.apiBase()}/v3/company/${realmId}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`quickbooks POST ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async requestToken(
    params: Record<string, string>,
  ): Promise<AccountingTokens> {
    const basicAuth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) throw new Error(`quickbooks token request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: body.expires_in,
    };
  }
}
