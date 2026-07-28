import { Inject, Injectable } from "@nestjs/common";
import type {
  ListAccountingConflictsQuery,
  ListAccountingSyncRunsQuery,
  ResolveAccountingConflictInput,
} from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { accountingConnections, accountingSyncConflicts, accountingSyncRuns } from "../../../infrastructure/db/schema";
import { CostTransactionsService } from "../../budgets";
import { AccountingConnectionsService } from "./accounting-connections.service";
import { AccountingSyncQueue } from "./accounting-sync.queue";
import {
  AccountingConnectionNotConnectedError,
  AccountingSyncConflictAlreadyResolvedError,
  AccountingSyncConflictNotFoundError,
  AccountingSyncRunNotFoundError,
} from "../domain/errors";
import { ACCOUNTING_PROVIDER, type AccountingProvider } from "../domain/provider";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// api.md §10's "sync runs" and "conflict queue" halves of the
// /integrations/accounting/… row (FR-PLAT-8). Connect/mapping live in the
// sibling AccountingConnectionsService.
@Injectable()
export class AccountingSyncService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly connections: AccountingConnectionsService,
    private readonly queue: AccountingSyncQueue,
    private readonly costTransactions: CostTransactionsService,
    @Inject(ACCOUNTING_PROVIDER) private readonly provider: AccountingProvider,
  ) {}

  async requestRun(tenantId: string, actorId: string, provider: string) {
    const connection = await withTenant(this.db, tenantId, (tx) => this.connections.requireConnection(tx, tenantId, provider));
    if (connection.status !== "connected") throw new AccountingConnectionNotConnectedError();

    const run = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(accountingSyncRuns)
        .values({ tenantId, connectionId: connection.id, provider, status: "queued", createdBy: actorId })
        .returning();
      return row!;
    });

    await this.queue.enqueue({ tenantId, actorId, connectionId: connection.id, syncRunId: run.id });
    return run;
  }

  async listRuns(tenantId: string, query: ListAccountingSyncRunsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(accountingSyncRuns.deletedAt)];
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(accountingSyncRuns.createdAt, new Date(c.createdAt)),
            and(eq(accountingSyncRuns.createdAt, new Date(c.createdAt)), lt(accountingSyncRuns.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.accountingSyncRuns.findMany({
        where: and(...conditions),
        orderBy: [desc(accountingSyncRuns.createdAt), desc(accountingSyncRuns.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getRun(tenantId: string, id: string) {
    const run = await withTenant(this.db, tenantId, (tx) =>
      tx.query.accountingSyncRuns.findFirst({ where: eq(accountingSyncRuns.id, id) }),
    );
    if (!run) throw new AccountingSyncRunNotFoundError();
    return run;
  }

  async listConflicts(tenantId: string, query: ListAccountingConflictsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(accountingSyncConflicts.deletedAt)];
      if (query.status) conditions.push(eq(accountingSyncConflicts.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(accountingSyncConflicts.createdAt, new Date(c.createdAt)),
            and(eq(accountingSyncConflicts.createdAt, new Date(c.createdAt)), lt(accountingSyncConflicts.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.accountingSyncConflicts.findMany({
        where: and(...conditions),
        orderBy: [desc(accountingSyncConflicts.createdAt), desc(accountingSyncConflicts.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  // keep_local: re-assert our value back onto QuickBooks, overwriting the
  // edit that caused the divergence. keep_remote: accept QuickBooks' value,
  // posting the delta as a new cost_transactions row (append-only ledger —
  // see CostTransactionsService.postFromAccountingSync's doc comment)
  // rather than mutating the original.
  async resolveConflict(tenantId: string, actorId: string, id: string, input: ResolveAccountingConflictInput) {
    const conflict = await withTenant(this.db, tenantId, (tx) =>
      tx.query.accountingSyncConflicts.findFirst({ where: eq(accountingSyncConflicts.id, id) }),
    );
    if (!conflict) throw new AccountingSyncConflictNotFoundError();
    if (conflict.status !== "open") throw new AccountingSyncConflictAlreadyResolvedError();

    const localValue = conflict.localValue as { amount: string };
    const remoteValue = conflict.remoteValue as { amount: string };

    if (input.resolution === "keep_local") {
      const run = await this.getRun(tenantId, conflict.syncRunId);
      const connection = await withTenant(this.db, tenantId, (tx) =>
        tx.query.accountingConnections.findFirst({ where: eq(accountingConnections.id, run.connectionId) }),
      );
      if (!connection) throw new AccountingConnectionNotConnectedError();
      const accessToken = await this.connections.getValidAccessToken(tenantId, connection);
      await this.provider.reassertTransactionAmount(accessToken, connection.realmId!, conflict.externalId, localValue.amount);
    } else {
      const original = await this.costTransactions.getById(tenantId, conflict.entityId);
      if (original) {
        const delta = (Number(remoteValue.amount) - Number(localValue.amount)).toFixed(2);
        if (Number(delta) !== 0) {
          await this.costTransactions.postFromAccountingSync(tenantId, actorId, original.projectId, {
            costCodeId: original.costCodeId,
            externalId: conflict.externalId,
            txnDate: new Date().toISOString().slice(0, 10),
            amount: delta,
          });
        }
      }
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(accountingSyncConflicts)
        .set({
          status: input.resolution === "keep_local" ? "resolved_local" : "resolved_remote",
          resolvedBy: actorId,
          resolvedAt: new Date(),
          updatedBy: actorId,
        })
        .where(eq(accountingSyncConflicts.id, id))
        .returning();
      return updated!;
    });
  }
}
