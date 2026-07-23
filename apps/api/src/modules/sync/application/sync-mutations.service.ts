import { Inject, Injectable } from "@nestjs/common";
import type { SyncMutationInput, SyncMutationResult } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { syncMutations } from "../../../infrastructure/db/schema";
import { DomainError } from "../../../platform/domain-error";
import { DailyReportsService, TimeEntriesService } from "../../daily-reports";
import { PermissionResolverService } from "../../rbac";
import { TasksService } from "../../tasks";
import { buildEntityHandlers, type SyncEntityHandler } from "./entity-handlers";

// M6 Mobile Sync. "Server applies [mutations] through the same use-case
// layer (validation + RBAC + events fire normally)" — every mutation here
// is dispatched to the exact same service methods a REST call would use,
// via the entity-handlers.ts registry, not a parallel write path.
// Field-level merge is intentionally narrow: without a per-field
// change-history table (not built this pass), the only case this can
// *correctly* auto-merge is "the value the client wanted is already the
// server's current value" (someone else made the same edit first) —
// genuine non-overlapping-field merging is flagged as follow-up work
// requiring that history. Everything else that doesn't cleanly apply goes
// to the conflict queue — NFR-12's "never silently dropped", not silently
// overwritten either.
@Injectable()
export class SyncMutationsService {
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

  async applyBatch(tenantId: string, actorId: string, mutations: SyncMutationInput[]): Promise<SyncMutationResult[]> {
    const results: SyncMutationResult[] = [];
    for (const mutation of mutations) {
      results.push(await this.applyOne(tenantId, actorId, mutation));
    }
    return results;
  }

  private async applyOne(tenantId: string, actorId: string, mutation: SyncMutationInput): Promise<SyncMutationResult> {
    const existing = await withTenant(this.db, tenantId, (tx) =>
      tx.query.syncMutations.findFirst({ where: eq(syncMutations.mutationId, mutation.mutationId) }),
    );
    if (existing) {
      // Idempotent replay — the same mutation_id was already processed
      // (client retried after a dropped ack). Return the stored outcome
      // rather than reprocessing.
      return { mutationId: mutation.mutationId, result: existing.result as SyncMutationResult["result"] };
    }

    const handler = this.handlers[mutation.entity];
    const permissionKey = handler?.permissions[mutation.op];
    if (!handler || !permissionKey || !(await this.permissions.has(tenantId, actorId, permissionKey))) {
      return this.record(tenantId, actorId, mutation, "rejected", { reason: "permission_denied" });
    }

    try {
      if (mutation.op === "create") {
        if (!handler.create || !handler.createSchema) {
          return this.record(tenantId, actorId, mutation, "rejected", { reason: "unsupported_operation" });
        }
        const parsed = handler.createSchema.safeParse(mutation.changes);
        if (!parsed.success) {
          return this.record(tenantId, actorId, mutation, "rejected", { reason: parsed.error.flatten() });
        }
        await handler.create(tenantId, actorId, parsed.data, mutation.entityId);
        return this.record(tenantId, actorId, mutation, "applied");
      }

      if (mutation.op === "delete") {
        if (!handler.remove) {
          return this.record(tenantId, actorId, mutation, "rejected", { reason: "unsupported_operation" });
        }
        try {
          await handler.remove(tenantId, actorId, mutation.entityId);
        } catch (err) {
          // Already gone is the desired end state for a delete — idempotent-safe.
          if (!(err instanceof DomainError) || err.code !== "not_found") throw err;
        }
        return this.record(tenantId, actorId, mutation, "applied");
      }

      // op === "update"
      if (!handler.update || !handler.updateSchema) {
        return this.record(tenantId, actorId, mutation, "rejected", { reason: "unsupported_operation" });
      }
      const parsedChanges = handler.updateSchema.safeParse(mutation.changes ?? {});
      if (!parsedChanges.success) {
        return this.record(tenantId, actorId, mutation, "rejected", { reason: parsedChanges.error.flatten() });
      }
      const fieldChanges = parsedChanges.data as Record<string, unknown>;

      const current = await handler.getById(tenantId, mutation.entityId);

      const alreadyConsistent = Object.entries(fieldChanges).every(
        ([key, value]) => stringifyField(current[key]) === stringifyField(value),
      );
      if (alreadyConsistent) {
        return this.record(tenantId, actorId, mutation, "merged");
      }

      if (current["updatedSeq"] !== mutation.baseVersion) {
        return this.record(tenantId, actorId, mutation, "conflict", {
          incoming: fieldChanges,
          serverSnapshot: current,
        });
      }

      try {
        await handler.update(tenantId, actorId, mutation.entityId, fieldChanges, mutation.baseVersion);
        return this.record(tenantId, actorId, mutation, "applied");
      } catch (err) {
        // A concurrent write landed between our version check and this
        // call — same "diverged and didn't match" outcome, just caught a
        // moment later.
        if (err instanceof DomainError && err.code === "version_conflict") {
          const latest = await handler.getById(tenantId, mutation.entityId);
          return this.record(tenantId, actorId, mutation, "conflict", { incoming: fieldChanges, serverSnapshot: latest });
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof DomainError && err.code === "not_found") {
        // Update targeting an entity the client's offline view still
        // thinks exists — surfaced for a human rather than silently
        // dropped (NFR-12).
        return this.record(tenantId, actorId, mutation, "conflict", {
          reason: "entity_not_found",
          incoming: mutation.changes,
        });
      }
      const message = err instanceof DomainError ? err.message : "failed to apply mutation";
      return this.record(tenantId, actorId, mutation, "rejected", { reason: message });
    }
  }

  private async record(
    tenantId: string,
    actorId: string,
    mutation: SyncMutationInput,
    result: SyncMutationResult["result"],
    conflictDetail?: unknown,
  ): Promise<SyncMutationResult> {
    await withTenant(this.db, tenantId, (tx) =>
      tx.insert(syncMutations).values({
        tenantId,
        clientId: mutation.clientId,
        mutationId: mutation.mutationId,
        userId: actorId,
        entityType: mutation.entity,
        entityId: mutation.entityId,
        op: mutation.op,
        capturedAt: new Date(mutation.capturedAt),
        result,
        conflictDetail: conflictDetail ?? null,
      }),
    );
    return { mutationId: mutation.mutationId, result };
  }
}

function stringifyField(value: unknown): string {
  return JSON.stringify(value ?? null);
}
