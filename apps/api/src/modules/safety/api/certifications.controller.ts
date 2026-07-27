import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createCertificationSchema, listCertificationsQuerySchema, updateCertificationSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { CertificationsService } from "../application/certifications.service";

// database.md §15 (M12): "certifications: person/sub ↔ cert type,
// expires_at ... FR-SAFE-2." Tenant-wide, not project-scoped.
@Controller("certifications")
export class CertificationsController {
  constructor(private readonly certifications: CertificationsService) {}

  @Get()
  @RequirePermission("safety.certification.read")
  list(
    @Query(new ZodValidationPipe(listCertificationsQuerySchema)) query: z.infer<typeof listCertificationsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.certifications.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("safety.certification.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createCertificationSchema)) body: z.infer<typeof createCertificationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.certifications.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Patch(":id")
  @RequirePermission("safety.certification.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCertificationSchema)) body: z.infer<typeof updateCertificationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.certifications.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
