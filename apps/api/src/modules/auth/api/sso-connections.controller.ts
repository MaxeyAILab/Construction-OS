import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { createSsoConnectionSchema, updateSsoConnectionSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import { RequirePermission } from "../../rbac";
import { SsoConnectionsService } from "../application/sso-connections.service";
import type { AuthenticatedRequest } from "./access-token.guard";

// api.md §2.1 "Enterprise SSO (SAML) + SCIM provisioning" — connection
// admin, all admin.sso.manage-gated.
@Controller("sso/connections")
export class SsoConnectionsController {
  constructor(private readonly connections: SsoConnectionsService) {}

  @Get()
  @RequirePermission("admin.sso.manage")
  list(@Req() req: AuthenticatedRequest) {
    return this.connections.list(req.auth!.tenantId);
  }

  @Post()
  @RequirePermission("admin.sso.manage")
  create(
    @Body(new ZodValidationPipe(createSsoConnectionSchema)) body: z.infer<typeof createSsoConnectionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connections.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Patch(":id")
  @RequirePermission("admin.sso.manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSsoConnectionSchema)) body: z.infer<typeof updateSsoConnectionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connections.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Delete(":id")
  @RequirePermission("admin.sso.manage")
  delete(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.connections.delete(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post(":id/rotate-scim-token")
  @RequirePermission("admin.sso.manage")
  async rotateScimToken(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const token = await this.connections.rotateScimToken(req.auth!.tenantId, req.auth!.sub, id);
    return { token };
  }
}
