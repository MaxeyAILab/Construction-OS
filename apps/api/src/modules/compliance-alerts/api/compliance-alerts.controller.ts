import { Controller, Get, Query, Req } from "@nestjs/common";
import { listComplianceAlertsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ComplianceAlertsQueryService } from "../application/compliance-alerts-query.service";

// api.md §15.4 (FR-SUB-2, FR-SAFE-2).
@Controller("compliance/alerts")
export class ComplianceAlertsController {
  constructor(private readonly complianceAlerts: ComplianceAlertsQueryService) {}

  @Get()
  @RequirePermission("safety.certification.read")
  list(
    @Query(new ZodValidationPipe(listComplianceAlertsQuerySchema)) query: z.infer<typeof listComplianceAlertsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.complianceAlerts.list(req.auth!.tenantId, query);
  }
}
