import { Injectable, Logger } from "@nestjs/common";
import type {
  AccountingAccount,
  AccountingProvider,
  AccountingTokens,
  PushCostTransactionInput,
} from "../domain/provider";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const API_BASE = "https://api.xero.com/api.xro/2.0";
const SCOPE = "openid profile email accounting.transactions accounting.settings offline_access";

interface XeroConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Real Xero adapter (FR-PLAT-8, roadmap.md "Sage & Xero connectors").
// Getting a Xero developer app costs nothing (same "free to register, no
// per-request fee" reasoning as QuickBooksProvider). No live app is
// registered in this environment (XERO_CLIENT_ID/SECRET unset — dialed
// lazily), so these payload shapes should be validated against a real Xero
// demo company before production use; FakeAccountingProvider is what every
// test in this codebase actually exercises.
//
// Two structural differences from QuickBooks, both handled here:
// (1) Xero's OAuth callback carries only code/state — the connected
// organization ("tenant") is resolved via a follow-up GET /connections
// call (resolveRealmId), not a query param.
// (2) Xero has no bare "expense with an account and no vendor" entity —
// the closest fit is a ManualJournal, which Xero enforces must balance
// (debit lines = credit lines). pushCostTransaction therefore posts two
// lines: a debit to the mapped cost-code account and a credit to the
// connection's configured clearingAccountId. Without a real accountant's
// input on what that clearing account should represent operationally,
// this is a reasonable but unvalidated modeling choice — flagged, not
// silently assumed correct.
@Injectable()
export class XeroProvider implements AccountingProvider {
  private readonly logger = new Logger(XeroProvider.name);

  constructor(private readonly config: XeroConfig) {}

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

  async resolveRealmId(accessToken: string): Promise<string> {
    const res = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`xero connections request failed: ${res.status} ${await res.text()}`);
    const connections = (await res.json()) as Array<{ tenantId: string }>;
    const first = connections[0];
    if (!first) throw new Error("xero account has no authorized organizations");
    return first.tenantId;
  }

  async listAccounts(accessToken: string, tenantId: string): Promise<AccountingAccount[]> {
    const body = (await this.apiGet(accessToken, tenantId, "Accounts")) as {
      Accounts?: Array<{ AccountID: string; Name: string; Type: string }>;
    };
    return (body.Accounts ?? []).map((a) => ({ id: a.AccountID, name: a.Name, type: a.Type }));
  }

  async pushCostTransaction(
    accessToken: string,
    tenantId: string,
    input: PushCostTransactionInput,
  ): Promise<{ externalId: string }> {
    if (!input.clearingAccountId) throw new Error("xero push requires a configured clearing account");

    const payload = {
      ManualJournals: [
        {
          Narration: input.memo ?? input.docNumber,
          Date: input.date,
          JournalLines: [
            { LineAmount: Number(input.amount), AccountCode: input.externalAccountId, Description: input.docNumber },
            { LineAmount: -Number(input.amount), AccountCode: input.clearingAccountId, Description: input.docNumber },
          ],
        },
      ],
    };
    const body = (await this.apiPost(accessToken, tenantId, "ManualJournals", payload)) as {
      ManualJournals: Array<{ ManualJournalID: string }>;
    };
    return { externalId: body.ManualJournals[0]!.ManualJournalID };
  }

  async getTransactionAmount(accessToken: string, tenantId: string, externalId: string): Promise<string | null> {
    const journal = await this.fetchJournal(accessToken, tenantId, externalId);
    if (!journal) return null;
    const debitLine = journal.JournalLines.find((l) => l.LineAmount > 0);
    return debitLine ? debitLine.LineAmount.toFixed(2) : null;
  }

  // Xero's ManualJournals endpoint updates via a full POST of the object
  // (no separate PATCH/SyncToken concept like QBO) — resend both balanced
  // lines with the new amount.
  async reassertTransactionAmount(accessToken: string, tenantId: string, externalId: string, amount: string): Promise<void> {
    const journal = await this.fetchJournal(accessToken, tenantId, externalId);
    if (!journal) return;

    const debitLine = journal.JournalLines.find((l) => l.LineAmount > 0);
    const creditLine = journal.JournalLines.find((l) => l.LineAmount < 0);
    if (!debitLine || !creditLine) return;

    const payload = {
      ManualJournals: [
        {
          ManualJournalID: externalId,
          Narration: journal.Narration,
          Date: journal.Date,
          JournalLines: [
            { ...debitLine, LineAmount: Number(amount) },
            { ...creditLine, LineAmount: -Number(amount) },
          ],
        },
      ],
    };
    await this.apiPost(accessToken, tenantId, "ManualJournals", payload);
  }

  private async fetchJournal(
    accessToken: string,
    tenantId: string,
    externalId: string,
  ): Promise<{ Narration: string; Date: string; JournalLines: Array<{ LineAmount: number; AccountCode: string }> } | null> {
    try {
      const body = (await this.apiGet(accessToken, tenantId, `ManualJournals/${externalId}`)) as {
        ManualJournals: Array<{ Narration: string; Date: string; JournalLines: Array<{ LineAmount: number; AccountCode: string }> }>;
      };
      return body.ManualJournals[0] ?? null;
    } catch (err) {
      this.logger.warn(`xero manual journal ${externalId} unreadable: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async apiGet(accessToken: string, tenantId: string, path: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": tenantId, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`xero GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async apiPost(accessToken: string, tenantId: string, path: string, payload: unknown): Promise<unknown> {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`xero POST ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async requestToken(params: Record<string, string>): Promise<AccountingTokens> {
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
    if (!res.ok) throw new Error(`xero token request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresInSeconds: body.expires_in };
  }
}
