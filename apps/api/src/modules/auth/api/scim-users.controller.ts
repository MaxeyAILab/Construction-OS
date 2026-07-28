import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { scimListQuerySchema, scimPatchRequestSchema, scimUserResourceSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Public } from "../../../platform/decorators/public.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import { ScimUsersService } from "../application/scim-users.service";
import type { ScimAuthenticatedRequest } from "./scim-auth.guard";
import { ScimAuthGuard } from "./scim-auth.guard";

// api.md §2.1 SCIM 2.0 Users — authenticated by the connection's own
// bearer token (ScimAuthGuard), not RBAC, so every route is @Public() to
// the global guards (see ScimAuthGuard's doc comment for why that's the
// correct posture here, not a gap).
@Controller("scim/v2/Users")
@UseGuards(ScimAuthGuard)
export class ScimUsersController {
  constructor(private readonly users: ScimUsersService) {}

  @Get()
  @Public()
  list(
    @Query(new ZodValidationPipe(scimListQuerySchema)) query: z.infer<typeof scimListQuerySchema>,
    @Req() req: ScimAuthenticatedRequest,
  ) {
    return this.users.list(req.scimAuth!.tenantId, req.scimAuth!.connectionId, query);
  }

  @Post()
  @Public()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(scimUserResourceSchema)) body: z.infer<typeof scimUserResourceSchema>,
    @Req() req: ScimAuthenticatedRequest,
  ) {
    const { tenantId, connectionId, defaultRoleId } = req.scimAuth!;
    return this.users.create(tenantId, connectionId, defaultRoleId, null, body);
  }

  @Get(":id")
  @Public()
  get(@Param("id") id: string, @Req() req: ScimAuthenticatedRequest) {
    return this.users.get(req.scimAuth!.tenantId, id);
  }

  @Put(":id")
  @Public()
  replace(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(scimUserResourceSchema)) body: z.infer<typeof scimUserResourceSchema>,
    @Req() req: ScimAuthenticatedRequest,
  ) {
    return this.users.replace(req.scimAuth!.tenantId, null, id, body);
  }

  @Patch(":id")
  @Public()
  patch(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(scimPatchRequestSchema)) body: z.infer<typeof scimPatchRequestSchema>,
    @Req() req: ScimAuthenticatedRequest,
  ) {
    const { tenantId, connectionId, defaultRoleId } = req.scimAuth!;
    return this.users.patch(tenantId, connectionId, defaultRoleId, null, id, body);
  }

  @Delete(":id")
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param("id") id: string, @Req() req: ScimAuthenticatedRequest) {
    const { tenantId, connectionId } = req.scimAuth!;
    return this.users.delete(tenantId, connectionId, null, id);
  }
}
