import { Controller, Get, Query, Req } from "@nestjs/common";
import { listFinanceAlertsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { FinanceAlertsQueryService } from "../application/finance-alerts-query.service";

// api.md §10 (Finance API, FR-FIN-6).
@Controller("finance/alerts")
export class FinanceAlertsController {
  constructor(private readonly financeAlerts: FinanceAlertsQueryService) {}

  @Get()
  @RequirePermission("finance.budget.read")
  list(
    @Query(new ZodValidationPipe(listFinanceAlertsQuerySchema)) query: z.infer<typeof listFinanceAlertsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.financeAlerts.list(req.auth!.tenantId, query);
  }
}
