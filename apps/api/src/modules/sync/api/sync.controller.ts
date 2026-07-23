import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { resolveSyncConflictSchema, syncDeltaQuerySchema, syncMutationBatchSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { SyncConflictsService } from "../application/sync-conflicts.service";
import { SyncDeltaService } from "../application/sync-delta.service";
import { SyncMutationsService } from "../application/sync-mutations.service";
import { SyncWorkingSetService } from "../application/sync-working-set.service";

// api.md §16.2 (architecture.md §14.2, M6 Mobile Sync). Every route here is
// @Authenticated() only — a batch of mutations, or the conflict queue, can
// each span multiple entities (tasks/daily_reports/time_entries), each
// needing a different real permission checked per-row inside
// SyncMutationsService/SyncConflictsService, same "no single fixed
// permission fits" reasoning as Change Orders' approve()/Scheduling's
// getActiveSchedule().
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
  @Authenticated()
  listConflicts(@Req() req: AuthenticatedRequest) {
    return this.conflicts.list(req.auth!.tenantId, req.auth!.sub);
  }

  @Post("conflicts/:id/resolve")
  @Authenticated()
  resolveConflict(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveSyncConflictSchema)) body: z.infer<typeof resolveSyncConflictSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conflicts.resolve(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
