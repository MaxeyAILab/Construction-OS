import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, ne } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  accountingConnections,
  accountingLinks,
  accountingSyncConflicts,
  accountingSyncRuns,
  costTransactions,
} from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { AccountingConnectionsService } from "./accounting-connections.service";
import type { AccountingProvider } from "../domain/provider";
import { ACCOUNTING_PROVIDER_REGISTRY, AccountingProviderRegistry } from "../domain/provider-registry";
import type { AccountingSyncJobData } from "./accounting-sync.queue";

const PUSH_BATCH_SIZE = 100;
const PULL_BATCH_SIZE = 200;

interface AccountingMapping {
  costCodeMappings: Array<{ costCodeId: string; externalAccountId: string; externalAccountName?: string }>;
  defaultExpenseAccountId?: string;
  defaultClearingAccountId?: string | undefined;
}

// The actual work behind AccountingSyncWorker's BullMQ consumer (FR-PLAT-8).
// Scope (documented, not a silent gap): v1 syncs cost_transactions only.
// Push = post unsynced cost_transactions to QuickBooks and record an
// accounting_links row (idempotent — reruns skip anything already linked).
// Pull = re-read every previously-pushed transaction's current QuickBooks
// amount; a divergence from what we last pushed means someone edited it on
// the QuickBooks side, which goes to the conflict queue for a human
// decision rather than being silently applied either direction (spec.md's
// "Live margin accuracy vs accounting" top-5 risk). Invoices/bills (AP/AR)
// are explicitly out of scope for this pass — pushing them to QuickBooks as
// real Bill/Invoice objects needs a customer/vendor identity-mapping
// subsystem this session doesn't build (no spec backing for how our
// suppliers/subcontractors/clients map to QuickBooks Customer/Vendor
// records); flagged as follow-up.
@Injectable()
export class AccountingSyncRunnerService {
  private readonly logger = new Logger(AccountingSyncRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly connections: AccountingConnectionsService,
    @Inject(ACCOUNTING_PROVIDER_REGISTRY) private readonly providers: AccountingProviderRegistry,
    private readonly outbox: OutboxService,
  ) {}

  async run(data: AccountingSyncJobData): Promise<void> {
    const { tenantId, actorId, connectionId, syncRunId } = data;
    const startedAt = Date.now();

    await withTenant(this.db, tenantId, (tx) =>
      tx.update(accountingSyncRuns).set({ status: "running", startedAt: new Date() }).where(eq(accountingSyncRuns.id, syncRunId)),
    );

    try {
      const connection = await withTenant(this.db, tenantId, (tx) =>
        tx.query.accountingConnections.findFirst({ where: eq(accountingConnections.id, connectionId) }),
      );
      if (!connection) throw new Error(`accounting connection ${connectionId} not found`);

      const provider = this.providers.resolve(connection.provider);
      const accessToken = await this.connections.getValidAccessToken(tenantId, connection);
      const mapping = (connection.mapping as AccountingMapping | null) ?? { costCodeMappings: [] };

      const { pushedCount, skippedCount } = await this.pushCostTransactions(
        tenantId,
        actorId,
        connection.realmId!,
        connection.provider,
        provider,
        accessToken,
        mapping,
      );
      const { pulledCount, conflictCount } = await this.verifyLinkedTransactions(
        tenantId,
        connection.realmId!,
        connection.provider,
        provider,
        accessToken,
        syncRunId,
      );

      await withTenant(this.db, tenantId, async (tx) => {
        await tx
          .update(accountingConnections)
          .set({ lastSyncedAt: new Date() })
          .where(eq(accountingConnections.id, connectionId));

        await tx
          .update(accountingSyncRuns)
          .set({
            status: "completed",
            completedAt: new Date(),
            durationMs: Date.now() - startedAt,
            pushedCount,
            pulledCount,
            conflictCount,
            skippedCount,
            updatedBy: actorId,
          })
          .where(eq(accountingSyncRuns.id, syncRunId));

        await this.outbox.append(tx, {
          tenantId,
          eventType: "accounting_sync_run.completed.v1",
          dedupeKey: `accounting_sync_run.completed.v1:${syncRunId}`,
          actorId,
          payload: { companyId: tenantId, connectionId, syncRunId, provider: connection.provider, pushedCount, conflictCount },
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`accounting sync run ${syncRunId} failed: ${message}`);
      await withTenant(this.db, tenantId, (tx) =>
        tx
          .update(accountingSyncRuns)
          .set({ status: "failed", error: message, durationMs: Date.now() - startedAt, updatedBy: actorId })
          .where(eq(accountingSyncRuns.id, syncRunId)),
      );
      throw err;
    }
  }

  private async pushCostTransactions(
    tenantId: string,
    actorId: string,
    realmId: string,
    provider: string,
    providerImpl: AccountingProvider,
    accessToken: string,
    mapping: AccountingMapping,
  ): Promise<{ pushedCount: number; skippedCount: number }> {
    const linked = await withTenant(this.db, tenantId, (tx) =>
      tx.query.accountingLinks.findMany({
        where: and(
          eq(accountingLinks.tenantId, tenantId),
          eq(accountingLinks.provider, provider),
          eq(accountingLinks.entityType, "cost_transaction"),
        ),
      }),
    );
    const linkedIds = new Set(linked.map((l) => l.entityId));

    const candidates = await withTenant(this.db, tenantId, (tx) =>
      tx.query.costTransactions.findMany({
        where: and(eq(costTransactions.tenantId, tenantId), ne(costTransactions.source, "accounting_sync")),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
        limit: PUSH_BATCH_SIZE + linkedIds.size,
      }),
    );
    const unsynced = candidates.filter((txn) => !linkedIds.has(txn.id)).slice(0, PUSH_BATCH_SIZE);

    let pushedCount = 0;
    let skippedCount = 0;

    for (const txn of unsynced) {
      const externalAccountId =
        mapping.costCodeMappings.find((m) => m.costCodeId === txn.costCodeId)?.externalAccountId ??
        mapping.defaultExpenseAccountId;
      if (!externalAccountId) {
        skippedCount++;
        continue;
      }

      const { externalId } = await providerImpl.pushCostTransaction(accessToken, realmId, {
        externalAccountId,
        amount: txn.amount,
        memo: txn.memo,
        date: txn.txnDate,
        docNumber: txn.id.slice(0, 21),
        clearingAccountId: mapping.defaultClearingAccountId,
      });

      await withTenant(this.db, tenantId, (tx) =>
        tx.insert(accountingLinks).values({
          tenantId,
          entityType: "cost_transaction",
          entityId: txn.id,
          provider,
          externalId,
          lastSyncedAt: new Date(),
          syncState: { pushedAmount: txn.amount },
          createdBy: actorId,
        }),
      );
      pushedCount++;
    }

    return { pushedCount, skippedCount };
  }

  private async verifyLinkedTransactions(
    tenantId: string,
    realmId: string,
    provider: string,
    providerImpl: AccountingProvider,
    accessToken: string,
    syncRunId: string,
  ): Promise<{ pulledCount: number; conflictCount: number }> {
    const links = await withTenant(this.db, tenantId, (tx) =>
      tx.query.accountingLinks.findMany({
        where: and(
          eq(accountingLinks.tenantId, tenantId),
          eq(accountingLinks.provider, provider),
          eq(accountingLinks.entityType, "cost_transaction"),
        ),
        orderBy: (l, { desc }) => [desc(l.lastSyncedAt)],
        limit: PULL_BATCH_SIZE,
      }),
    );

    let pulledCount = 0;
    let conflictCount = 0;

    for (const link of links) {
      const remoteAmount = await providerImpl.getTransactionAmount(accessToken, realmId, link.externalId);
      if (remoteAmount === null) continue;

      const syncState = (link.syncState as { pushedAmount: string } | null) ?? { pushedAmount: remoteAmount };
      const diverged = Number(remoteAmount).toFixed(2) !== Number(syncState.pushedAmount).toFixed(2);

      if (diverged) {
        await withTenant(this.db, tenantId, async (tx) => {
          await tx.insert(accountingSyncConflicts).values({
            tenantId,
            syncRunId,
            entityType: "cost_transaction",
            entityId: link.entityId,
            externalId: link.externalId,
            localValue: { amount: syncState.pushedAmount },
            remoteValue: { amount: remoteAmount },
            status: "open",
          });
          await tx
            .update(accountingLinks)
            .set({ lastSyncedAt: new Date(), syncState: { pushedAmount: remoteAmount } })
            .where(eq(accountingLinks.id, link.id));
        });
        conflictCount++;
      } else {
        await withTenant(this.db, tenantId, (tx) =>
          tx.update(accountingLinks).set({ lastSyncedAt: new Date() }).where(eq(accountingLinks.id, link.id)),
        );
      }
      pulledCount++;
    }

    return { pulledCount, conflictCount };
  }
}
