import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { createTransmittalSchema, listTransmittalsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { PermissionDeniedError, PermissionResolverService, RequirePermission } from "../../rbac";
import { TransmittalsService } from "../application/transmittals.service";
import { parseColonAction } from "./parse-colon-action";

// api.md §20 (M3, FR-DOC-8).
@Controller()
export class TransmittalsController {
  constructor(
    private readonly transmittals: TransmittalsService,
    private readonly permissions: PermissionResolverService,
  ) {}

  @Get("projects/:id/transmittals")
  @RequirePermission("docs.transmittal.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listTransmittalsQuerySchema)) query: z.infer<typeof listTransmittalsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transmittals.list(req.auth!.tenantId, projectId, query);
  }

  @Post("projects/:id/transmittals")
  @RequirePermission("docs.transmittal.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createTransmittalSchema)) body: z.infer<typeof createTransmittalSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transmittals.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("transmittals/:id")
  @RequirePermission("docs.transmittal.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.transmittals.getById(req.auth!.tenantId, id);
  }

  // See parse-colon-action.ts: ":id::send" / ":id::acknowledge" don't
  // route correctly (and collide with each other) as separate decorators,
  // so both actions share one plain-param route and dispatch in code.
  // :send is permission-gated (docs.transmittal.send, checked manually
  // since @RequirePermission can't vary per action on one handler);
  // :acknowledge is a pure identity check the caller must be one of this
  // transmittal's own recipients, enforced inside TransmittalsService
  // (403 otherwise), same identity-check shape as approval-instances'
  // :decide.
  @Post("transmittals/:idAction")
  @Authenticated()
  async sendOrAcknowledge(@Param("idAction") idAction: string, @Req() req: AuthenticatedRequest) {
    const { id, action } = parseColonAction(idAction);
    const tenantId = req.auth!.tenantId;
    const actorId = req.auth!.sub;

    if (action === "send") {
      if (!(await this.permissions.has(tenantId, actorId, "docs.transmittal.send"))) {
        throw new PermissionDeniedError("docs.transmittal.send");
      }
      return this.transmittals.send(tenantId, actorId, id);
    }
    if (action === "acknowledge") {
      return this.transmittals.acknowledge(tenantId, actorId, id);
    }
    throw new NotFoundException();
  }
}
