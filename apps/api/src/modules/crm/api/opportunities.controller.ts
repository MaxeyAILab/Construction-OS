import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createActivitySchema,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  loseOpportunitySchema,
  updateOpportunitySchema,
  winOpportunitySchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ActivitiesService } from "../application/activities.service";
import { OpportunitiesService } from "../application/opportunities.service";
import { OpportunityLifecycleService } from "../application/opportunity-lifecycle.service";

// api.md §4 (M1 CRM, FR-CRM-1/2/4).
@Controller("crm/opportunities")
export class OpportunitiesController {
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly lifecycle: OpportunityLifecycleService,
    private readonly activities: ActivitiesService,
  ) {}

  @Get()
  @RequirePermission("crm.opportunity.read")
  list(
    @Query(new ZodValidationPipe(listOpportunitiesQuerySchema)) query: z.infer<typeof listOpportunitiesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.opportunities.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("crm.opportunity.create")
  create(
    @Body(new ZodValidationPipe(createOpportunitySchema)) body: z.infer<typeof createOpportunitySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.opportunities.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("crm.opportunity.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.opportunities.getById(req.auth!.tenantId, id);
  }

  // Stage moves are audited via this same generic PATCH (api.md: "Stage
  // moves audited") — not a separate action endpoint.
  @Patch(":id")
  @RequirePermission("crm.opportunity.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOpportunitySchema)) body: z.infer<typeof updateOpportunitySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.opportunities.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post(":id/win")
  @RequirePermission("crm.opportunity.win")
  win(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(winOpportunitySchema)) body: z.infer<typeof winOpportunitySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.lifecycle.win(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post(":id/lose")
  @RequirePermission("crm.opportunity.update")
  lose(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(loseOpportunitySchema)) body: z.infer<typeof loseOpportunitySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.lifecycle.lose(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Get(":id/activities")
  @RequirePermission("crm.activity.read")
  async listActivities(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    await this.opportunities.getById(req.auth!.tenantId, id); // 404 if the opportunity doesn't exist
    return this.activities.listForOpportunity(req.auth!.tenantId, id);
  }

  @Post(":id/activities")
  @RequirePermission("crm.activity.create")
  async createActivity(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createActivitySchema)) body: z.infer<typeof createActivitySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.opportunities.getById(req.auth!.tenantId, id); // 404 if the opportunity doesn't exist
    return this.activities.createForOpportunity(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
