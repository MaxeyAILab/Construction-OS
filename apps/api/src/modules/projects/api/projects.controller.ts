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
  Query,
  Req,
  UseInterceptors,
} from "@nestjs/common";
import {
  addProjectMemberSchema,
  createCostCodeSchema,
  createMilestoneSchema,
  createProjectSchema,
  createProjectTemplateSchema,
  listProjectsQuerySchema,
  updateCostCodeSchema,
  updateMilestoneSchema,
  updateProjectSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { IdempotencyInterceptor } from "../../../platform/idempotency/idempotency.interceptor";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { CostCodesService } from "../application/cost-codes.service";
import { MilestonesService } from "../application/milestones.service";
import { ProjectMembersService } from "../application/project-members.service";
import { ProjectSummaryService } from "../application/project-summary.service";
import { ProjectTemplatesService } from "../application/project-templates.service";
import { ProjectsQueryService } from "../application/projects-query.service";
import { ProjectsService } from "../application/projects.service";

@Controller()
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly projectsQuery: ProjectsQueryService,
    private readonly summary: ProjectSummaryService,
    private readonly members: ProjectMembersService,
    private readonly costCodes: CostCodesService,
    private readonly milestones: MilestonesService,
    private readonly templates: ProjectTemplatesService,
  ) {}

  @Get("projects")
  @RequirePermission("projects.project.read")
  list(
    @Query(new ZodValidationPipe(listProjectsQuerySchema)) query: z.infer<typeof listProjectsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.projectsQuery.list(req.auth!.tenantId, query);
  }

  @Post("projects")
  @RequirePermission("projects.project.create")
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createProjectSchema)) body: z.infer<typeof createProjectSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.projects.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get("projects/:id")
  @RequirePermission("projects.project.read")
  get(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.projects.get(req.auth!.tenantId, id);
  }

  @Patch("projects/:id")
  @RequirePermission("projects.project.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: z.infer<typeof updateProjectSchema>,
    @Headers("if-match") ifMatch: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const version = ifMatch !== undefined ? Number.parseInt(ifMatch, 10) : undefined;
    return this.projects.update(req.auth!.tenantId, req.auth!.sub, id, body, version);
  }

  @Delete("projects/:id")
  @RequirePermission("projects.project.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.projects.remove(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Get("projects/:id/summary")
  @RequirePermission("projects.project.read")
  getSummary(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.summary.get(req.auth!.tenantId, id);
  }

  @Get("projects/:id/members")
  @RequirePermission("projects.member.manage")
  listMembers(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.members.list(req.auth!.tenantId, id);
  }

  @Post("projects/:id/members")
  @RequirePermission("projects.member.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async addMember(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) body: z.infer<typeof addProjectMemberSchema>,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.members.add(req.auth!.tenantId, req.auth!.sub, id, body.userId);
  }

  @Delete("projects/:id/members/:userId")
  @RequirePermission("projects.member.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.members.remove(req.auth!.tenantId, req.auth!.sub, id, userId);
  }

  @Get("projects/:id/cost-codes")
  @RequirePermission("projects.costcode.manage")
  listCostCodes(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.costCodes.list(req.auth!.tenantId, id);
  }

  @Post("projects/:id/cost-codes")
  @RequirePermission("projects.costcode.manage")
  @HttpCode(HttpStatus.CREATED)
  createCostCode(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createCostCodeSchema)) body: z.infer<typeof createCostCodeSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.costCodes.create(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Patch("projects/:id/cost-codes/:costCodeId")
  @RequirePermission("projects.costcode.manage")
  updateCostCode(
    @Param("id") id: string,
    @Param("costCodeId") costCodeId: string,
    @Body(new ZodValidationPipe(updateCostCodeSchema)) body: z.infer<typeof updateCostCodeSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.costCodes.update(req.auth!.tenantId, req.auth!.sub, id, costCodeId, body);
  }

  @Get("projects/:id/milestones")
  @RequirePermission("projects.project.read")
  listMilestones(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.milestones.list(req.auth!.tenantId, id);
  }

  @Post("projects/:id/milestones")
  @RequirePermission("projects.project.update")
  @HttpCode(HttpStatus.CREATED)
  createMilestone(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createMilestoneSchema)) body: z.infer<typeof createMilestoneSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.milestones.create(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Patch("projects/:id/milestones/:milestoneId")
  @RequirePermission("projects.project.update")
  updateMilestone(
    @Param("id") id: string,
    @Param("milestoneId") milestoneId: string,
    @Body(new ZodValidationPipe(updateMilestoneSchema)) body: z.infer<typeof updateMilestoneSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.milestones.update(req.auth!.tenantId, req.auth!.sub, id, milestoneId, body);
  }

  // Not documented in api.md §3 (which only covers project_id-scoped
  // sub-resources) — added anyway since FR-PM-4 ("project templates for
  // rapid, consistent setup") is otherwise unreachable: nothing else in
  // the spec describes how a template gets created in the first place.
  // Flagged as a gap to reconcile with api.md if/when it's revised.
  @Get("project-templates")
  @RequirePermission("projects.project.read")
  listTemplates(@Req() req: AuthenticatedRequest) {
    return this.templates.list(req.auth!.tenantId);
  }

  @Post("project-templates")
  @RequirePermission("projects.project.create")
  @HttpCode(HttpStatus.CREATED)
  createTemplate(
    @Body(new ZodValidationPipe(createProjectTemplateSchema))
    body: z.infer<typeof createProjectTemplateSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.templates.create(req.auth!.tenantId, req.auth!.sub, body);
  }
}
