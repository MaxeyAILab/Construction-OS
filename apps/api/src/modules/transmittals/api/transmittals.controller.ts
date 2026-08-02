import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { createTransmittalSchema, listTransmittalsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { TransmittalsService } from "../application/transmittals.service";

// api.md §20 (M3, FR-DOC-8).
@Controller()
export class TransmittalsController {
  constructor(private readonly transmittals: TransmittalsService) {}

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

  @Post("transmittals/:id::send")
  @RequirePermission("docs.transmittal.send")
  send(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.transmittals.send(req.auth!.tenantId, req.auth!.sub, id);
  }

  // @Authenticated(), not a permission — the caller must be one of this
  // transmittal's own recipients, checked inside the service (403
  // otherwise), same identity-check shape as approval-instances' :decide.
  @Post("transmittals/:id::acknowledge")
  @Authenticated()
  acknowledge(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.transmittals.acknowledge(req.auth!.tenantId, req.auth!.sub, id);
  }
}
