import { Controller, Get, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { EquipmentInsightsService } from "../application/equipment-insights.service";

// api.md §11: "GET /equipment/ai/insights | Idle assets, predictive
// maintenance, rent-vs-buy (FR-EQ-4)". A separate empty-prefix controller
// with the full literal path — same "static route lives outside the
// resource controller's own :id route" precedent as
// procurement-ai.controller.ts's "procurement/ai/recommendations".
// Reuses equipment.equipment.read (the "+AI reuses base permission"
// convention used by every AI row this session).
@Controller()
export class EquipmentInsightsController {
  constructor(private readonly insights: EquipmentInsightsService) {}

  @Get("equipment/ai/insights")
  @RequirePermission("equipment.equipment.read")
  list(@Req() req: AuthenticatedRequest) {
    return this.insights.listInsights(req.auth!.tenantId);
  }
}
