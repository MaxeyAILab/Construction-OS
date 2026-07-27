import { Body, Controller, Post, Req } from "@nestjs/common";
import { cashflowForecastRequestSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { CashflowForecastService } from "../application/cashflow-forecast.service";

// api.md §10: "POST /finance/ai/cashflow-forecast | + AI |
// {horizon_weeks} -> projected inflows/outflows + confidence bands
// (FR-FIN-7)." "+AI" reuses the base finance.invoice.read permission
// (the forecast is derived entirely from invoice data that permission
// already governs) rather than a separate AI-specific key — same
// convention as documents' drawing-set diff endpoint.
@Controller("finance/ai/cashflow-forecast")
export class CashflowForecastController {
  constructor(private readonly cashflowForecast: CashflowForecastService) {}

  @Post()
  @RequirePermission("finance.invoice.read")
  forecast(
    @Body(new ZodValidationPipe(cashflowForecastRequestSchema))
    body: z.infer<typeof cashflowForecastRequestSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cashflowForecast.forecast(req.auth!.tenantId, req.auth!.sub, body.horizonWeeks);
  }
}
