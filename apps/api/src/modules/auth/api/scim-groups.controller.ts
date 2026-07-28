import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { scimPatchRequestSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Public } from "../../../platform/decorators/public.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import { ScimGroupsService } from "../application/scim-groups.service";
import type { ScimAuthenticatedRequest } from "./scim-auth.guard";
import { ScimAuthGuard } from "./scim-auth.guard";

// api.md §2.1 SCIM 2.0 Groups (one per tenant role, read-only identity;
// PATCH syncs membership only — see ScimGroupsService's doc comment).
@Controller("scim/v2/Groups")
@UseGuards(ScimAuthGuard)
export class ScimGroupsController {
  constructor(private readonly groups: ScimGroupsService) {}

  @Get()
  @Public()
  list(@Req() req: ScimAuthenticatedRequest) {
    return this.groups.list(req.scimAuth!.tenantId);
  }

  @Get(":id")
  @Public()
  get(@Param("id") id: string, @Req() req: ScimAuthenticatedRequest) {
    return this.groups.get(req.scimAuth!.tenantId, id);
  }

  @Patch(":id")
  @Public()
  patch(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(scimPatchRequestSchema)) body: z.infer<typeof scimPatchRequestSchema>,
    @Req() req: ScimAuthenticatedRequest,
  ) {
    return this.groups.patchMembers(req.scimAuth!.tenantId, req.scimAuth!.connectionId, id, body);
  }
}
