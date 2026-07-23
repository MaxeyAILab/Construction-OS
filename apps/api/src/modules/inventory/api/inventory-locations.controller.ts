import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { createInventoryLocationSchema, listInventoryLocationsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { InventoryLocationsService } from "../application/inventory-locations.service";

@Controller("inventory/locations")
export class InventoryLocationsController {
  constructor(private readonly locations: InventoryLocationsService) {}

  @Get()
  @RequirePermission("inventory.location.read")
  list(
    @Query(new ZodValidationPipe(listInventoryLocationsQuerySchema))
    query: z.infer<typeof listInventoryLocationsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.locations.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("inventory.location.create")
  create(
    @Body(new ZodValidationPipe(createInventoryLocationSchema)) body: z.infer<typeof createInventoryLocationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.locations.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("inventory.location.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.locations.getById(req.auth!.tenantId, id);
  }
}
