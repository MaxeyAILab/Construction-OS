import { Injectable, Logger } from "@nestjs/common";
import type {
  AccountingAccount,
  AccountingProvider,
  AccountingTokens,
  PushCostTransactionInput,
} from "../domain/provider";

const AUTHORIZE_URL = "https://www.sageone.com/oauth2/auth/central";
const TOKEN_URL = "https://oauth.accounting.sage.com/token";
const API_BASE = "https://api.accounting.sage.com/v3.1";
const SCOPE = "full_access";

interface SageConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Real Sage Business Cloud Accounting adapter (FR-PLAT-8, roadmap.md "Sage
// & Xero connectors"). Same "free developer app, dialed lazily, unvalidated
// against a real sandbox in this environment" posture as
// QuickBooksProvider/XeroProvider — SAGE_CLIENT_ID/SECRET are unset here;
// FakeAccountingProvider is what every test actually exercises.
//
// Same two structural differences as Xero, for the same reason (both are
// "real" double-entry accounting systems, unlike QuickBooks' Purchase
// entity): (1) the connected business id isn't in the OAuth callback —
// resolveRealmId looks it up via GET /businesses; (2) there's no bare
// expense entity, so pushCostTransaction posts a balanced journal (debit
// the mapped cost-code account, credit the connection's
// defaultClearingAccountId) — same unvalidated-but-documented modeling
// choice as Xero's ManualJournal lines.
@Injectable()
export class SageProvider implements AccountingProvider {
  private readonly logger = new Logger(SageProvider.name);

  constructor(private readonly config: SageConfig) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      filter: "apiv3.1",
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
    const res = await fetch(`${API_BASE}/businesses`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`sage businesses request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { $items?: Array<{ id: string }> };
    const first = body.$items?.[0];
    if (!first) throw new Error("sage account has no accessible businesses");
    return first.id;
  }

  async listAccounts(accessToken: string, businessId: string): Promise<AccountingAccount[]> {
    const body = (await this.apiGet(accessToken, businessId, "ledger_accounts")) as {
      $items?: Array<{ id: string; displayed_as: string; ledger_account_classification?: { displayed_as: string } }>;
    };
    return (body.$items ?? []).map((a) => ({
      id: a.id,
      name: a.displayed_as,
      type: a.ledger_account_classification?.displayed_as ?? "unknown",
    }));
  }

  async pushCostTransaction(
    accessToken: string,
    businessId: string,
    input: PushCostTransactionInput,
  ): Promise<{ externalId: string }> {
    if (!input.clearingAccountId) throw new Error("sage push requires a configured clearing account");

    const payload = {
      journal: {
        date: input.date,
        reference: input.docNumber,
        journal_lines: [
          { ledger_account_id: input.externalAccountId, details: input.memo ?? input.docNumber, debit: input.amount },
          { ledger_account_id: input.clearingAccountId, details: input.memo ?? input.docNumber, credit: input.amount },
        ],
      },
    };
    const body = (await this.apiPost(accessToken, businessId, "journals", payload)) as { journal: { id: string } };
    return { externalId: body.journal.id };
  }

  async getTransactionAmount(accessToken: string, businessId: string, externalId: string): Promise<string | null> {
    const journal = await this.fetchJournal(accessToken, businessId, externalId);
    if (!journal) return null;
    const debitLine = journal.journal_lines.find((l) => l.debit);
    return debitLine?.debit ?? null;
  }

  // Sage journals update via PUT of the full object — no separate sparse-
  // update/SyncToken concept, resend both balanced lines with the new
  // amount.
  async reassertTransactionAmount(accessToken: string, businessId: string, externalId: string, amount: string): Promise<void> {
    const journal = await this.fetchJournal(accessToken, businessId, externalId);
    if (!journal) return;

    const debitLine = journal.journal_lines.find((l) => l.debit);
    const creditLine = journal.journal_lines.find((l) => l.credit);
    if (!debitLine || !creditLine) return;

    const payload = {
      journal: {
        date: journal.date,
        reference: journal.reference,
        journal_lines: [
          { ...debitLine, debit: amount },
          { ...creditLine, credit: amount },
        ],
      },
    };
    await this.apiPut(accessToken, businessId, `journals/${externalId}`, payload);
  }

  private async fetchJournal(
    accessToken: string,
    businessId: string,
    externalId: string,
  ): Promise<{
    date: string;
    reference: string;
    journal_lines: Array<{ ledger_account_id: string; debit?: string; credit?: string }>;
  } | null> {
    try {
      const body = (await this.apiGet(accessToken, businessId, `journals/${externalId}`)) as {
        journal: { date: string; reference: string; journal_lines: Array<{ ledger_account_id: string; debit?: string; credit?: string }> };
      };
      return body.journal;
    } catch (err) {
      this.logger.warn(`sage journal ${externalId} unreadable: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async apiGet(accessToken: string, businessId: string, path: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}/${path}?business_id=${businessId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`sage GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async apiPost(accessToken: string, businessId: string, path: string, payload: unknown): Promise<unknown> {
    const res = await fetch(`${API_BASE}/${path}?business_id=${businessId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`sage POST ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async apiPut(accessToken: string, businessId: string, path: string, payload: unknown): Promise<unknown> {
    const res = await fetch(`${API_BASE}/${path}?business_id=${businessId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`sage PUT ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async requestToken(params: Record<string, string>): Promise<AccountingTokens> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: this.config.clientId, client_secret: this.config.clientSecret }).toString(),
    });
    if (!res.ok) throw new Error(`sage token request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresInSeconds: body.expires_in };
  }
}
