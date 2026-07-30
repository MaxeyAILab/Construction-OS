import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  batchUpdateScheduleActivitiesSchema,
  createResourceAssignmentSchema,
  createScheduleActivitySchema,
  createScheduleBaselineSchema,
  lookaheadQuerySchema,
  replaceActivityDependenciesSchema,
  resourceConflictsQuerySchema,
  simulateDelayImpactSchema,
  updateScheduleActivitySchema,
} from "@constructionos/schemas";
import type { FastifyReply } from "fastify";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ActivitiesService } from "../application/activities.service";
import { DelayImpactService } from "../application/delay-impact.service";
import { DependenciesService } from "../application/dependencies.service";
import { LookaheadService } from "../application/lookahead.service";
import { RecalculateService } from "../application/recalculate.service";
import { ResourceAssignmentsService } from "../application/resource-assignments.service";
import { PredictiveScheduleRiskService } from "../application/predictive-schedule-risk.service";
import { ResourceConflictsService } from "../application/resource-conflicts.service";
import { SchedulesService } from "../application/schedules.service";

@Controller()
export class SchedulingController {
  constructor(
    private readonly schedules: SchedulesService,
    private readonly activities: ActivitiesService,
    private readonly dependencies: DependenciesService,
    private readonly recalculateService: RecalculateService,
    private readonly resourceAssignments: ResourceAssignmentsService,
    private readonly lookahead: LookaheadService,
    private readonly resourceConflicts: ResourceConflictsService,
    private readonly delayImpact: DelayImpactService,
    private readonly predictiveRisk: PredictiveScheduleRiskService,
  ) {}

  // M13 Client Portal v1 (FR-CLIENT-1): schedule.read (internal) or a
  // project-level client-portal "view" share — dual authorization inside
  // SchedulesService.getActiveSchedule(), same @Authenticated() pattern as
  // Change Orders' approve().
  @Get("projects/:id/schedule")
  @Authenticated()
  getActiveSchedule(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.schedules.getActiveSchedule(req.auth!.tenantId, req.auth!.sub, projectId);
  }

  @Post("projects/:id/schedule/baselines")
  @RequirePermission("schedule.baseline")
  @HttpCode(HttpStatus.CREATED)
  createBaseline(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createScheduleBaselineSchema)) body: z.infer<typeof createScheduleBaselineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.schedules.createBaseline(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("schedules/:id/activities")
  @RequirePermission("schedule.read")
  listActivities(@Param("id") scheduleId: string, @Req() req: AuthenticatedRequest) {
    return this.activities.list(req.auth!.tenantId, scheduleId);
  }

  @Post("schedules/:id/activities")
  @RequirePermission("schedule.update")
  @HttpCode(HttpStatus.CREATED)
  createActivity(
    @Param("id") scheduleId: string,
    @Body(new ZodValidationPipe(createScheduleActivitySchema)) body: z.infer<typeof createScheduleActivitySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.activities.create(req.auth!.tenantId, req.auth!.sub, scheduleId, body);
  }

  // api.md §6: "PATCH /activities:batch for drag-multiselect" — literal
  // colon escaped as `::` (find-my-way parses a bare `:` anywhere in a
  // segment as a parametric start; same fix applied to Documents' and
  // Estimating's own colon-suffixed routes earlier this session). The path
  // clients actually call is unchanged: /schedules/{id}/activities:batch.
  @Patch("schedules/:id/activities::batch")
  @RequirePermission("schedule.update")
  batchUpdateActivities(
    @Param("id") scheduleId: string,
    @Body(new ZodValidationPipe(batchUpdateScheduleActivitiesSchema))
    body: z.infer<typeof batchUpdateScheduleActivitiesSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.activities.batchUpdate(req.auth!.tenantId, req.auth!.sub, scheduleId, body);
  }

  // Gap-fill: api.md §6 groups GET/POST/PATCH/DELETE under one row without
  // an itemized detail-GET path — same precedent as RFIs' getById.
  @Get("activities/:id")
  @RequirePermission("schedule.read")
  getActivity(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.activities.getById(req.auth!.tenantId, id);
  }

  // api.md §1.6 (global convention): mutable resources carry a version and
  // updates send If-Match -> 409 on mismatch.
  @Patch("activities/:id")
  @RequirePermission("schedule.update")
  updateActivity(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateScheduleActivitySchema)) body: z.infer<typeof updateScheduleActivitySchema>,
    @Headers("if-match") ifMatch: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const ifMatchVersion = ifMatch === undefined ? undefined : Number.parseInt(ifMatch, 10);
    return this.activities.update(req.auth!.tenantId, req.auth!.sub, id, body, ifMatchVersion);
  }

  @Delete("activities/:id")
  @RequirePermission("schedule.update")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeActivity(@Param("id") id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.activities.remove(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Put("activities/:id/dependencies")
  @RequirePermission("schedule.update")
  replaceDependencies(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replaceActivityDependenciesSchema))
    body: z.infer<typeof replaceActivityDependenciesSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dependencies.replace(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // api.md §6: "CPM run — sync <500 activities, else 202 job." 200 is the
  // default (an update, not a creation); the async branch below overrides
  // it to 202 at runtime via @Res({ passthrough: true }), since which one
  // applies isn't knowable from the route alone.
  @Post("schedules/:id/recalculate")
  @RequirePermission("schedule.update")
  @HttpCode(HttpStatus.OK)
  async recalculate(
    @Param("id") scheduleId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.recalculateService.recalculate(req.auth!.tenantId, req.auth!.sub, scheduleId);
    if (result.async) {
      res.status(HttpStatus.ACCEPTED);
      return { jobId: result.jobId };
    }
    return { schedule: result.schedule, activities: result.activities };
  }

  // Gap-fill: FR-SCH-5's "assign resources/crews to activities" needs a
  // create/read/remove route api.md §6's table doesn't itemize (only the
  // read-side lookahead/conflicts rows) — same precedent as Equipment's own
  // gap-filled assignment routes.
  @Get("activities/:id/resources")
  @RequirePermission("schedule.read")
  listResourceAssignments(@Param("id") activityId: string, @Req() req: AuthenticatedRequest) {
    return this.resourceAssignments.listForActivity(req.auth!.tenantId, activityId);
  }

  @Post("activities/:id/resources")
  @RequirePermission("schedule.update")
  @HttpCode(HttpStatus.CREATED)
  createResourceAssignment(
    @Param("id") activityId: string,
    @Body(new ZodValidationPipe(createResourceAssignmentSchema)) body: z.infer<typeof createResourceAssignmentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.resourceAssignments.create(req.auth!.tenantId, req.auth!.sub, activityId, body);
  }

  @Delete("resources/:id")
  @RequirePermission("schedule.update")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeResourceAssignment(@Param("id") id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.resourceAssignments.remove(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Get("projects/:id/lookahead")
  @Authenticated()
  getLookahead(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(lookaheadQuerySchema)) query: z.infer<typeof lookaheadQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.lookahead.getLookahead(req.auth!.tenantId, req.auth!.sub, projectId, query);
  }

  @Get("resources/conflicts")
  @RequirePermission("schedule.resources")
  getResourceConflicts(
    @Query(new ZodValidationPipe(resourceConflictsQuerySchema)) query: z.infer<typeof resourceConflictsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.resourceConflicts.listConflicts(req.auth!.tenantId, query);
  }

  // api.md §6: "+AI" reuses the base schedule.read permission rather than
  // a separate AI-specific key — same convention as
  // daily-reports.controller.ts's ai-summary endpoint. A pure simulation:
  // nothing is written back to schedule_activities.
  @Post("schedules/:id/ai/impact")
  @RequirePermission("schedule.read")
  simulateImpact(
    @Param("id") scheduleId: string,
    @Body(new ZodValidationPipe(simulateDelayImpactSchema)) body: z.infer<typeof simulateDelayImpactSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.delayImpact.simulateImpact(req.auth!.tenantId, req.auth!.sub, scheduleId, body);
  }

  // api.md §6: "GET /schedules/{id}/ai/risk" — same "+AI reuses the base
  // schedule.read permission" convention as simulateImpact above. Read-only:
  // nothing is written back to schedule_activities.
  @Get("schedules/:id/ai/risk")
  @RequirePermission("schedule.read")
  getRisk(@Param("id") scheduleId: string, @Req() req: AuthenticatedRequest) {
    return this.predictiveRisk.computeRisk(req.auth!.tenantId, scheduleId);
  }
}
