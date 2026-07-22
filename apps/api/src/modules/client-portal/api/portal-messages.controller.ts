import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { createPortalMessageSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { PortalMessagesService } from "../application/portal-messages.service";

// M13 Client Portal v1 (FR-CLIENT-3). No api.md section documents these
// endpoints. Dual authorization inside PortalMessagesService (internal
// client.message.read/create, or a project-level client-portal
// view/comment share) — both routes are @Authenticated() rather than
// @RequirePermission for that reason, same pattern as Change Orders'
// approve() and the broadened Scheduling/Documents reads.
@Controller()
export class PortalMessagesController {
  constructor(private readonly messages: PortalMessagesService) {}

  @Get("projects/:id/portal-messages")
  @Authenticated()
  list(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.messages.list(req.auth!.tenantId, req.auth!.sub, projectId);
  }

  @Post("projects/:id/portal-messages")
  @Authenticated()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createPortalMessageSchema)) body: z.infer<typeof createPortalMessageSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.messages.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }
}
