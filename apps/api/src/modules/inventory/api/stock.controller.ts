import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { createStockMovementSchema, listStockMovementsQuerySchema, stockQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { StockService } from "../application/stock.service";

@Controller("inventory")
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get("stock")
  @RequirePermission("inventory.stock.read")
  getStock(
    @Query(new ZodValidationPipe(stockQuerySchema)) query: z.infer<typeof stockQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stock.getStock(req.auth!.tenantId, query);
  }

  @Get("movements")
  @RequirePermission("inventory.movement.read")
  listMovements(
    @Query(new ZodValidationPipe(listStockMovementsQuerySchema)) query: z.infer<typeof listStockMovementsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stock.listMovements(req.auth!.tenantId, query);
  }

  // api.md §11: "POST /inventory/movements | issue/transfer/adjust (kind),
  // validated against stock; issues cost to project (FR-INV-2)".
  @Post("movements")
  @RequirePermission("inventory.movement.create")
  postMovement(
    @Body(new ZodValidationPipe(createStockMovementSchema)) body: z.infer<typeof createStockMovementSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stock.postMovement(req.auth!.tenantId, req.auth!.sub, body);
  }
}
