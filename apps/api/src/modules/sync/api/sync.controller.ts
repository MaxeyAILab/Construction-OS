import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { resolveSyncConflictSchema, syncDeltaQuerySchema, syncMutationBatchSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SyncConflictsService } from "../application/sync-conflicts.service";
import { SyncDeltaService } from "../application/sync-delta.service";
import { SyncMutationsService } from "../application/sync-mutations.service";
import { SyncWorkingSetService } from "../application/sync-working-set.service";

// api.md §16.2 (architecture.md §14.2, M6 Mobile Sync). /sync/mutations,
// /delta, and /working-set are @Authenticated() only — a batch of
// mutations can span create/update/delete on the caller's own working
// set, each needing a different real permission (checked per-mutation
// inside SyncMutationsService, same "no single fixed permission fits"
// reasoning as Change Orders' approve()/Scheduling's getActiveSchedule().
// /conflicts is gated by tasks.task.update since v1's only syncable
// entity is tasks — a second entity would need this to become a per-
// entity check too, same as the mutation engine's own PERMISSIONS map.
@Controller("sync")
export class SyncController {
  constructor(
    private readonly mutations: SyncMutationsService,
    private readonly delta: SyncDeltaService,
    private readonly workingSet: SyncWorkingSetService,
    private readonly conflicts: SyncConflictsService,
  ) {}

  @Post("mutations")
  @Authenticated()
  async postMutations(
    @Body(new ZodValidationPipe(syncMutationBatchSchema)) body: z.infer<typeof syncMutationBatchSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.mutations.applyBatch(req.auth!.tenantId, req.auth!.sub, body.mutations);
  }

  @Get("delta")
  @Authenticated()
  async getDelta(
    @Query(new ZodValidationPipe(syncDeltaQuerySchema)) query: z.infer<typeof syncDeltaQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const scopes = query.scopes ? query.scopes.split(",").map((s) => s.trim()) : ["tasks"];
    return this.delta.getDelta(req.auth!.tenantId, req.auth!.sub, query.sinceSeq, scopes);
  }

  @Get("working-set")
  @Authenticated()
  getWorkingSet(@Req() req: AuthenticatedRequest) {
    return this.workingSet.getWorkingSet(req.auth!.tenantId, req.auth!.sub);
  }

  @Get("conflicts")
  @RequirePermission("tasks.task.update")
  listConflicts(@Req() req: AuthenticatedRequest) {
    return this.conflicts.list(req.auth!.tenantId);
  }

  @Post("conflicts/:id/resolve")
  @RequirePermission("tasks.task.update")
  resolveConflict(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveSyncConflictSchema)) body: z.infer<typeof resolveSyncConflictSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conflicts.resolve(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
