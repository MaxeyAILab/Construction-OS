import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { updateCompanySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import { RequirePermission } from "../../rbac";
import { CompanySettingsService } from "../application/company-settings.service";
import type { AuthenticatedRequest } from "./access-token.guard";

// api.md §15: "GET/PATCH /admin/company | admin.company.manage | Settings,
// locale, branding, fiscal config." Roadmap Phase 2 "Second locale +
// metric units (NFR-30 activation)" row. §15.7 adds parent_company_id to
// PATCH and the /children listing (FR-PLAT-9 multi-company/holding
// structures).
@Controller("admin/company")
export class CompanySettingsController {
  constructor(private readonly companySettings: CompanySettingsService) {}

  @Get()
  @RequirePermission("admin.company.manage")
  get(@Req() req: AuthenticatedRequest) {
    return this.companySettings.get(req.auth!.tenantId);
  }

  @Patch()
  @RequirePermission("admin.company.manage")
  update(
    @Body(new ZodValidationPipe(updateCompanySchema)) body: z.infer<typeof updateCompanySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.companySettings.update(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get("children")
  @RequirePermission("admin.company.manage")
  listChildren(@Req() req: AuthenticatedRequest) {
    return this.companySettings.listChildren(req.auth!.tenantId);
  }
}
