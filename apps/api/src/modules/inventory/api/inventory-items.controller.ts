import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { createInventoryItemSchema, listInventoryItemsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { InventoryItemsService } from "../application/inventory-items.service";

@Controller("inventory/items")
export class InventoryItemsController {
  constructor(private readonly items: InventoryItemsService) {}

  @Get()
  @RequirePermission("inventory.item.read")
  list(
    @Query(new ZodValidationPipe(listInventoryItemsQuerySchema)) query: z.infer<typeof listInventoryItemsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.items.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("inventory.item.create")
  create(
    @Body(new ZodValidationPipe(createInventoryItemSchema)) body: z.infer<typeof createInventoryItemSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.items.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("inventory.item.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.items.getById(req.auth!.tenantId, id);
  }
}
