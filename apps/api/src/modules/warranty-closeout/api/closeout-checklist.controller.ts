import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { createCloseoutChecklistItemSchema, updateCloseoutChecklistItemSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { CloseoutChecklistService } from "../application/closeout-checklist.service";

// api.md §18 (FR-CLOSE-1).
@Controller()
export class CloseoutChecklistController {
  constructor(private readonly checklist: CloseoutChecklistService) {}

  @Get("projects/:id/closeout/checklist")
  @RequirePermission("closeout.checklist_item.read")
  list(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.checklist.list(req.auth!.tenantId, projectId);
  }

  @Post("projects/:id/closeout/checklist")
  @RequirePermission("closeout.checklist_item.create")
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createCloseoutChecklistItemSchema)) body: z.infer<typeof createCloseoutChecklistItemSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checklist.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Patch("closeout/checklist/:id")
  @RequirePermission("closeout.checklist_item.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCloseoutChecklistItemSchema)) body: z.infer<typeof updateCloseoutChecklistItemSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checklist.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
