import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { createPipelineStageSchema, updatePipelineStageSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { PipelineStagesService } from "../application/pipeline-stages.service";

// api.md §4: "Tenant stage config" — crm.settings.manage gates all
// mutation, same "settings.manage governs its own config resource"
// precedent as admin.share.manage/crm.settings.manage.
@Controller("crm/pipeline-stages")
export class PipelineStagesController {
  constructor(private readonly pipelineStages: PipelineStagesService) {}

  @Get()
  @RequirePermission("crm.settings.manage")
  list(@Req() req: AuthenticatedRequest) {
    return this.pipelineStages.list(req.auth!.tenantId);
  }

  @Post()
  @RequirePermission("crm.settings.manage")
  create(
    @Body(new ZodValidationPipe(createPipelineStageSchema)) body: z.infer<typeof createPipelineStageSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.pipelineStages.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Patch(":id")
  @RequirePermission("crm.settings.manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePipelineStageSchema)) body: z.infer<typeof updatePipelineStageSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.pipelineStages.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
