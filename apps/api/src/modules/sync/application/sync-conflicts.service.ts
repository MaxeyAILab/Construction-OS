import { Inject, Injectable } from "@nestjs/common";
import type { ResolveSyncConflictInput } from "@constructionos/schemas";
import { desc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { syncMutations } from "../../../infrastructure/db/schema";
import { DailyReportsService, TimeEntriesService } from "../../daily-reports";
import { PermissionResolverService } from "../../rbac";
import { TasksService } from "../../tasks";
import {
  ConflictResolutionPermissionDeniedError,
  ManualResolutionRequiresChangesError,
  SyncConflictAlreadyResolvedError,
  SyncConflictNotFoundError,
} from "../domain/errors";
import { buildEntityHandlers, type SyncEntityHandler } from "./entity-handlers";

interface ConflictDetail {
  incoming?: Record<string, unknown>;
  serverSnapshot?: unknown;
  reason?: unknown;
}

// api.md §16.2: "GET /sync/conflicts · POST /sync/conflicts/{id}/resolve —
// Human resolution queue (NFR-12 — never silent loss)." A conflict IS a
// sync_mutations row with result='conflict' — resolving it transitions
// that same row rather than creating a new one, since the row already
// carries everything needed to re-decide (incoming vs. server-snapshot).
@Injectable()
export class SyncConflictsService {
  private readonly handlers: Record<string, SyncEntityHandler>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly permissions: PermissionResolverService,
    tasks: TasksService,
    dailyReports: DailyReportsService,
    timeEntries: TimeEntriesService,
  ) {
    this.handlers = buildEntityHandlers(tasks, dailyReports, timeEntries);
  }

  // Scoped to conflicts on entities the caller can actually resolve —
  // same reasoning api.md §1.1 uses everywhere else: never show a queue
  // item you'd then 403 on.
  async list(tenantId: string, actorId: string) {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx.query.syncMutations.findMany({
        where: eq(syncMutations.result, "conflict"),
        orderBy: [desc(syncMutations.appliedAt)],
      }),
    );

    const visible: (typeof rows)[number][] = [];
    for (const row of rows) {
      if (await this.canResolve(tenantId, actorId, row.entityType)) visible.push(row);
    }
    return visible;
  }

  async resolve(tenantId: string, actorId: string, conflictId: string, input: ResolveSyncConflictInput) {
    const conflict = await withTenant(this.db, tenantId, (tx) =>
      tx.query.syncMutations.findFirst({ where: eq(syncMutations.id, conflictId) }),
    );
    if (!conflict) throw new SyncConflictNotFoundError();
    if (conflict.result !== "conflict") throw new SyncConflictAlreadyResolvedError();
    if (!(await this.canResolve(tenantId, actorId, conflict.entityType))) {
      throw new ConflictResolutionPermissionDeniedError();
    }

    const handler = this.handlers[conflict.entityType];
    const detail = (conflict.conflictDetail ?? {}) as ConflictDetail;
    let newResult: "applied" | "rejected";

    if (input.resolution === "accept_server") {
      // The offline mutation is explicitly discarded — the server's
      // current state wins, nothing to write.
      newResult = "rejected";
    } else {
      const changes =
        input.resolution === "manual"
          ? (() => {
              if (!input.manualChanges) throw new ManualResolutionRequiresChangesError();
              return input.manualChanges;
            })()
          : (detail.incoming ?? {});

      if (!handler?.update || !handler.updateSchema) throw new ConflictResolutionPermissionDeniedError();
      const parsed = handler.updateSchema.parse(changes) as Record<string, unknown>;
      const current = await handler.getById(tenantId, conflict.entityId);
      await handler.update(tenantId, actorId, conflict.entityId, parsed, current["updatedSeq"] as number);
      newResult = "applied";
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(syncMutations)
        .set({ result: newResult, conflictDetail: { ...detail, resolution: input.resolution } })
        .where(eq(syncMutations.id, conflictId))
        .returning();
      return updated!;
    });
  }

  private async canResolve(tenantId: string, actorId: string, entityType: string): Promise<boolean> {
    const permissionKey = this.handlers[entityType]?.permissions.update;
    if (!permissionKey) return false;
    return this.permissions.has(tenantId, actorId, permissionKey);
  }
}
