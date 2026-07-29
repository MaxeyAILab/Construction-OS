import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { createWarrantyClaimSchema, updateWarrantyClaimSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { WarrantyClaimsService } from "../application/warranty-claims.service";

// api.md §18 (FR-CLOSE-5). list/create are dual-path (internal permission
// or a client-portal share) — the guard only requires login and the real
// record-level check happens inside WarrantyClaimsService, same
// "@Authenticated() + application-layer share-scope rule" shape as
// ChangeOrdersController.approve/PortalMessagesController.
@Controller()
export class WarrantyClaimsController {
  constructor(private readonly claims: WarrantyClaimsService) {}

  @Get("warranties/:id/claims")
  @Authenticated()
  list(@Param("id") warrantyId: string, @Req() req: AuthenticatedRequest) {
    return this.claims.list(req.auth!.tenantId, req.auth!.sub, warrantyId);
  }

  @Post("warranties/:id/claims")
  @Authenticated()
  create(
    @Param("id") warrantyId: string,
    @Body(new ZodValidationPipe(createWarrantyClaimSchema)) body: z.infer<typeof createWarrantyClaimSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.claims.create(req.auth!.tenantId, req.auth!.sub, warrantyId, body);
  }

  @Patch("claims/:id")
  @RequirePermission("closeout.claim.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWarrantyClaimSchema)) body: z.infer<typeof updateWarrantyClaimSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.claims.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
