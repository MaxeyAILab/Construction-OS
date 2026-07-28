import { Controller, Get, Query, Req } from "@nestjs/common";
import { listAuditLogQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { AuditQueryService } from "../application/audit-query.service";

// api.md §15: /admin/* + admin.* naming.
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get("admin/audit-log")
  @RequirePermission("admin.audit.read")
  list(
    @Query(new ZodValidationPipe(listAuditLogQuerySchema))
    query: z.infer<typeof listAuditLogQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.audit.list(req.auth!.tenantId, query);
  }
}
