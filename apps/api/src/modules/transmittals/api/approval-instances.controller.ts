import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { decideApprovalInstanceSchema, startApprovalInstanceSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { ApprovalInstancesService } from "../application/approval-instances.service";

// api.md §20 (M3, FR-DOC-9). @Authenticated() throughout — start/read
// resolve their real permission per entity_type inside the service (same
// shape as Custom Fields' values endpoints), and :decide is a pure
// identity check (only the current step's named approver may call it).
@Controller("approval-instances")
export class ApprovalInstancesController {
  constructor(private readonly instances: ApprovalInstancesService) {}

  @Post()
  @Authenticated()
  @HttpCode(HttpStatus.CREATED)
  start(
    @Body(new ZodValidationPipe(startApprovalInstanceSchema)) body: z.infer<typeof startApprovalInstanceSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.instances.start(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @Authenticated()
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.instances.getById(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post(":id::decide")
  @Authenticated()
  decide(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideApprovalInstanceSchema)) body: z.infer<typeof decideApprovalInstanceSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.instances.decide(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
