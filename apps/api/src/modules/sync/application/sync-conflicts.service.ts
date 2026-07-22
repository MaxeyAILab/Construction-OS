import { Inject, Injectable } from "@nestjs/common";
import type { ResolveSyncConflictInput } from "@constructionos/schemas";
import { updateTaskSchema } from "@constructionos/schemas";
import { desc, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { syncMutations } from "../../../infrastructure/db/schema";
import {
  ManualResolutionRequiresChangesError,
  SyncConflictAlreadyResolvedError,
  SyncConflictNotFoundError,
} from "../domain/errors";
import { TasksService } from "../../tasks";

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
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tasks: TasksService,
  ) {}

  async list(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.syncMutations.findMany({
        where: eq(syncMutations.result, "conflict"),
        orderBy: [desc(syncMutations.appliedAt)],
      }),
    );
  }

  async resolve(tenantId: string, actorId: string, conflictId: string, input: ResolveSyncConflictInput) {
    const conflict = await withTenant(this.db, tenantId, (tx) =>
      tx.query.syncMutations.findFirst({ where: eq(syncMutations.id, conflictId) }),
    );
    if (!conflict) throw new SyncConflictNotFoundError();
    if (conflict.result !== "conflict") throw new SyncConflictAlreadyResolvedError();

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

      const parsed = updateTaskSchema.parse(changes);
      const current = await this.tasks.getById(tenantId, conflict.entityId);
      await this.tasks.update(tenantId, actorId, conflict.entityId, parsed, current.updatedSeq);
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
}
