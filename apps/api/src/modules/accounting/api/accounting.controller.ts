import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import {
  connectAccountingSchema,
  listAccountingConflictsQuerySchema,
  listAccountingSyncRunsQuerySchema,
  resolveAccountingConflictSchema,
  updateAccountingMappingSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { Public } from "../../../platform/decorators/public.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { AccountingConnectionsService } from "../application/accounting-connections.service";
import { AccountingSyncService } from "../application/accounting-sync.service";

// api.md §10: "GET/POST /integrations/accounting/… | admin.integration.manage
// | Connect, mapping, sync runs, conflict queue (FR-PLAT-8)." /callback is
// the one route without @RequirePermission: it's a browser redirect from
// Intuit, not an authenticated API call — the signed `state` param
// (AccountingOAuthStateService) is what authenticates the tenant/actor on
// that request, same role a magic-link token plays for
// POST /auth/magic-link/verify.
@Controller("integrations/accounting")
export class AccountingController {
  constructor(
    private readonly connections: AccountingConnectionsService,
    private readonly sync: AccountingSyncService,
  ) {}

  @Post("connect")
  @RequirePermission("admin.integration.manage")
  connect(
    @Body(new ZodValidationPipe(connectAccountingSchema)) body: z.infer<typeof connectAccountingSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connections.connect(req.auth!.tenantId, req.auth!.sub, body);
  }

  // realmId is only present in this query string for QuickBooks — Sage/
  // Xero resolve their organization id via a follow-up API call instead
  // (AccountingConnectionsService.handleCallback -> provider.resolveRealmId).
  @Get("callback")
  @Public()
  callback(@Query() query: { code: string; state: string; realmId?: string | undefined }, @Req() req: AuthenticatedRequest) {
    const redirectUri = `${req.protocol}://${req.hostname}/v1/integrations/accounting/callback`;
    return this.connections.handleCallback({ code: query.code, state: query.state, realmId: query.realmId, redirectUri });
  }

  @Get("status")
  @RequirePermission("admin.integration.manage")
  status(@Query("provider") provider: string, @Req() req: AuthenticatedRequest) {
    return this.connections.getStatus(req.auth!.tenantId, provider);
  }

  @Post("disconnect")
  @RequirePermission("admin.integration.manage")
  disconnect(@Query("provider") provider: string, @Req() req: AuthenticatedRequest) {
    return this.connections.disconnect(req.auth!.tenantId, req.auth!.sub, provider);
  }

  @Get("accounts")
  @RequirePermission("admin.integration.manage")
  listAccounts(@Query("provider") provider: string, @Req() req: AuthenticatedRequest) {
    return this.connections.listAccounts(req.auth!.tenantId, provider);
  }

  @Get("mapping")
  @RequirePermission("admin.integration.manage")
  getMapping(@Query("provider") provider: string, @Req() req: AuthenticatedRequest) {
    return this.connections.getMapping(req.auth!.tenantId, provider);
  }

  @Put("mapping")
  @RequirePermission("admin.integration.manage")
  updateMapping(
    @Query("provider") provider: string,
    @Body(new ZodValidationPipe(updateAccountingMappingSchema)) body: z.infer<typeof updateAccountingMappingSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connections.updateMapping(req.auth!.tenantId, req.auth!.sub, provider, body);
  }

  @Post("sync-runs")
  @RequirePermission("admin.integration.manage")
  requestSyncRun(@Query("provider") provider: string, @Req() req: AuthenticatedRequest) {
    return this.sync.requestRun(req.auth!.tenantId, req.auth!.sub, provider);
  }

  @Get("sync-runs")
  @RequirePermission("admin.integration.manage")
  listSyncRuns(
    @Query(new ZodValidationPipe(listAccountingSyncRunsQuerySchema)) query: z.infer<typeof listAccountingSyncRunsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sync.listRuns(req.auth!.tenantId, query);
  }

  @Get("sync-runs/:id")
  @RequirePermission("admin.integration.manage")
  getSyncRun(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.sync.getRun(req.auth!.tenantId, id);
  }

  @Get("conflicts")
  @RequirePermission("admin.integration.manage")
  listConflicts(
    @Query(new ZodValidationPipe(listAccountingConflictsQuerySchema)) query: z.infer<typeof listAccountingConflictsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sync.listConflicts(req.auth!.tenantId, query);
  }

  @Post("conflicts/:id/resolve")
  @RequirePermission("admin.integration.manage")
  resolveConflict(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveAccountingConflictSchema)) body: z.infer<typeof resolveAccountingConflictSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sync.resolveConflict(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
