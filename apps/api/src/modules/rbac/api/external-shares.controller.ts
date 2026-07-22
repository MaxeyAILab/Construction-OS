import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from "@nestjs/common";
import { createExternalShareSchema, listExternalSharesQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { ExternalSharesService } from "../application/external-shares.service";
import { RequirePermission } from "./require-permission.decorator";

// api.md §15: "GET/POST /admin/external-shares | admin.share.manage |
// Client/sub/supplier grants (FR-RBAC-3)." A separate controller (not
// folded into RbacController, which is still @Controller("rbac")) so this
// brand-new endpoint matches api.md's literal /admin/... path rather than
// compounding the already-flagged /rbac-vs-/admin prefix inconsistency.
@Controller()
export class ExternalSharesController {
  constructor(private readonly shares: ExternalSharesService) {}

  @Get("admin/external-shares")
  @RequirePermission("admin.share.manage")
  list(
    @Query(new ZodValidationPipe(listExternalSharesQuerySchema))
    query: z.infer<typeof listExternalSharesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.shares.list(req.auth!.tenantId, query);
  }

  @Post("admin/external-shares")
  @RequirePermission("admin.share.manage")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createExternalShareSchema)) body: z.infer<typeof createExternalShareSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.shares.create(req.auth!.tenantId, req.auth!.sub, body);
  }
}
