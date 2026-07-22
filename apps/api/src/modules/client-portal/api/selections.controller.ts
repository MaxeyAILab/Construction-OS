import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from "@nestjs/common";
import {
  createClientSelectionSchema,
  decideClientSelectionSchema,
  updateClientSelectionSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SelectionsService } from "../application/selections.service";

// M13 Client Portal v1 (FR-CLIENT-2). No api.md section documents these
// endpoints (api.md has no dedicated Client Portal API section at all),
// so the shape follows this session's established REST conventions:
// project-scoped list/create, flat get/update/action by id.
@Controller()
export class SelectionsController {
  constructor(private readonly selections: SelectionsService) {}

  // list/getById accept a project-level client-portal "view" share
  // alongside client.selection.read (dual path inside the service).
  @Get("projects/:id/selections")
  @Authenticated()
  list(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.selections.list(req.auth!.tenantId, req.auth!.sub, projectId);
  }

  @Post("projects/:id/selections")
  @RequirePermission("client.selection.manage")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createClientSelectionSchema)) body: z.infer<typeof createClientSelectionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.selections.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("selections/:id")
  @Authenticated()
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.selections.getById(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Patch("selections/:id")
  @RequirePermission("client.selection.manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClientSelectionSchema)) body: z.infer<typeof updateClientSelectionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.selections.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // Dual path inside SelectionsService.decide(): internal
  // client.selection.manage, or a per-selection external_shares grant
  // (entity_type='client_selection', access='approve') — same pattern as
  // Change Orders' approve().
  @Post("selections/:id/decide")
  @Authenticated()
  decide(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideClientSelectionSchema)) body: z.infer<typeof decideClientSelectionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.selections.decide(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
