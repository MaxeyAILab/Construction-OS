import { Inject, Injectable } from "@nestjs/common";
import type { ConnectAccountingInput, UpdateAccountingMappingInput } from "@constructionos/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { accountingConnections, costCodes } from "../../../infrastructure/db/schema";
import { EncryptionService } from "../../auth";
import { OutboxService } from "../../events";
import { AccountingConnectionNotConnectedError, AccountingConnectionNotFoundError } from "../domain/errors";
import { ACCOUNTING_PROVIDER, type AccountingProvider } from "../domain/provider";
import { AccountingOAuthStateService } from "../infrastructure/oauth-state.service";

// Refresh proactively once fewer than 5 minutes of validity remain, rather
// than waiting for a live call to 401 — same "refresh ahead of expiry"
// approach as RefreshTokenService's rotation window.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

// api.md §10: "GET/POST /integrations/accounting/… | admin.integration.manage
// | Connect, mapping, sync runs, conflict queue (FR-PLAT-8)." This service
// owns the "Connect" and "mapping" halves; AccountingSyncService (sibling)
// owns "sync runs" and "conflict queue".
@Injectable()
export class AccountingConnectionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly encryption: EncryptionService,
    private readonly oauthState: AccountingOAuthStateService,
    @Inject(ACCOUNTING_PROVIDER) private readonly provider: AccountingProvider,
  ) {}

  async connect(tenantId: string, actorId: string, input: ConnectAccountingInput): Promise<{ authorizationUrl: string }> {
    await withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.accountingConnections.findFirst({
        where: and(eq(accountingConnections.tenantId, tenantId), eq(accountingConnections.provider, input.provider)),
      });
      if (!existing) {
        await tx.insert(accountingConnections).values({
          tenantId,
          provider: input.provider,
          status: "pending",
          createdBy: actorId,
        });
      }
    });

    const state = this.oauthState.issue({ tenantId, actorId, provider: input.provider });
    return { authorizationUrl: this.provider.getAuthorizationUrl(state) };
  }

  // The redirect target Intuit sends the user's browser back to — no
  // Authorization header is available on this request (see
  // AccountingController's @Public() on this route), so `state` is what
  // authenticates the tenant/actor, same role MagicLinkService's token
  // plays for /auth/magic-link/verify.
  async handleCallback(input: { code: string; state: string; realmId: string; redirectUri: string }) {
    const { tenantId, actorId, provider } = this.oauthState.consume(input.state);
    const tokens = await this.provider.exchangeCode(input.code, input.redirectUri);

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(accountingConnections)
        .set({
          status: "connected",
          realmId: input.realmId,
          accessTokenEnc: this.encryption.encrypt(tokens.accessToken),
          refreshTokenEnc: this.encryption.encrypt(tokens.refreshToken),
          tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
          error: null,
          updatedBy: actorId,
        })
        .where(and(eq(accountingConnections.tenantId, tenantId), eq(accountingConnections.provider, provider)))
        .returning();
      if (!updated) throw new AccountingConnectionNotFoundError();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "accounting_connection.connected.v1",
        dedupeKey: `accounting_connection.connected.v1:${updated.id}`,
        actorId,
        payload: { companyId: tenantId, connectionId: updated.id, provider, realmId: input.realmId },
      });

      return { status: updated.status, provider: updated.provider };
    });
  }

  async getStatus(tenantId: string, provider: string) {
    const connection = await withTenant(this.db, tenantId, (tx) =>
      tx.query.accountingConnections.findFirst({
        where: and(eq(accountingConnections.tenantId, tenantId), eq(accountingConnections.provider, provider)),
      }),
    );
    if (!connection) throw new AccountingConnectionNotFoundError();
    // Never surface encrypted token material over the API.
    const { accessTokenEnc: _a, refreshTokenEnc: _r, ...safe } = connection;
    return safe;
  }

  async disconnect(tenantId: string, actorId: string, provider: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const connection = await this.requireConnection(tx, tenantId, provider);

      const [updated] = await tx
        .update(accountingConnections)
        .set({
          status: "disconnected",
          accessTokenEnc: null,
          refreshTokenEnc: null,
          tokenExpiresAt: null,
          updatedBy: actorId,
        })
        .where(eq(accountingConnections.id, connection.id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "accounting_connection.disconnected.v1",
        dedupeKey: `accounting_connection.disconnected.v1:${connection.id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, connectionId: connection.id, provider },
      });

      return updated!;
    });
  }

  async listAccounts(tenantId: string, provider: string) {
    const connection = await withTenant(this.db, tenantId, (tx) => this.requireConnection(tx, tenantId, provider));
    const accessToken = await this.getValidAccessToken(tenantId, connection);
    return this.provider.listAccounts(accessToken, connection.realmId!);
  }

  async getMapping(tenantId: string, provider: string) {
    const connection = await withTenant(this.db, tenantId, (tx) => this.requireConnection(tx, tenantId, provider));
    return (connection.mapping as UpdateAccountingMappingInput | null) ?? { costCodeMappings: [] };
  }

  async updateMapping(tenantId: string, actorId: string, provider: string, input: UpdateAccountingMappingInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const connection = await this.requireConnection(tx, tenantId, provider);

      const costCodeIds = input.costCodeMappings.map((m) => m.costCodeId);
      if (costCodeIds.length > 0) {
        const found = await tx.query.costCodes.findMany({ where: inArray(costCodes.id, costCodeIds) });
        if (found.length !== new Set(costCodeIds).size) {
          throw new Error("one or more cost codes in the mapping do not exist");
        }
      }

      const [updated] = await tx
        .update(accountingConnections)
        .set({ mapping: input, updatedBy: actorId })
        .where(eq(accountingConnections.id, connection.id))
        .returning();
      return updated!;
    });
  }

  // Internal, used by AccountingSyncRunnerService — re-fetches/refreshes
  // ahead of expiry and persists the rotated tokens, same "refresh ahead,
  // persist the new pair" shape as RefreshTokenService.
  async getValidAccessToken(tenantId: string, connection: typeof accountingConnections.$inferSelect): Promise<string> {
    if (connection.status !== "connected" || !connection.accessTokenEnc || !connection.refreshTokenEnc) {
      throw new AccountingConnectionNotConnectedError();
    }

    const expiresAt = connection.tokenExpiresAt?.getTime() ?? 0;
    if (expiresAt - Date.now() > REFRESH_SKEW_MS) {
      return this.encryption.decrypt(connection.accessTokenEnc);
    }

    const refreshToken = this.encryption.decrypt(connection.refreshTokenEnc);
    const tokens = await this.provider.refreshAccessToken(refreshToken);

    await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(accountingConnections)
        .set({
          accessTokenEnc: this.encryption.encrypt(tokens.accessToken),
          refreshTokenEnc: this.encryption.encrypt(tokens.refreshToken),
          tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
        })
        .where(eq(accountingConnections.id, connection.id)),
    );

    return tokens.accessToken;
  }

  async requireConnection(tx: Database, tenantId: string, provider: string) {
    const connection = await tx.query.accountingConnections.findFirst({
      where: and(eq(accountingConnections.tenantId, tenantId), eq(accountingConnections.provider, provider)),
    });
    if (!connection) throw new AccountingConnectionNotFoundError();
    return connection;
  }
}
