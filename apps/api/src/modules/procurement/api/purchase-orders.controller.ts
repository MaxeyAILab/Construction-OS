import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createDeliverySchema,
  createPurchaseOrderLineSchema,
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderLineSchema,
  updatePurchaseOrderSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { DeliveriesService } from "../application/deliveries.service";
import { PurchaseOrderLifecycleService } from "../application/purchase-order-lifecycle.service";
import { PurchaseOrdersService } from "../application/purchase-orders.service";

@Controller("purchase-orders")
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly lifecycle: PurchaseOrderLifecycleService,
    private readonly deliveries: DeliveriesService,
  ) {}

  @Get()
  @RequirePermission("procurement.po.read")
  list(
    @Query(new ZodValidationPipe(listPurchaseOrdersQuerySchema)) query: z.infer<typeof listPurchaseOrdersQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchaseOrders.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("procurement.po.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createPurchaseOrderSchema)) body: z.infer<typeof createPurchaseOrderSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchaseOrders.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("procurement.po.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.purchaseOrders.getById(req.auth!.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission("procurement.po.update")
  updateHeader(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) body: z.infer<typeof updatePurchaseOrderSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchaseOrders.updateHeader(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post(":id/lines")
  @RequirePermission("procurement.po.update")
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createPurchaseOrderLineSchema)) body: z.infer<typeof createPurchaseOrderLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchaseOrders.addLine(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Patch(":id/lines/:lineId")
  @RequirePermission("procurement.po.update")
  updateLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderLineSchema)) body: z.infer<typeof updatePurchaseOrderLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.purchaseOrders.updateLine(req.auth!.tenantId, req.auth!.sub, id, lineId, body);
  }

  @Delete(":id/lines/:lineId")
  @RequirePermission("procurement.po.update")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLine(@Param("id") id: string, @Param("lineId") lineId: string, @Req() req: AuthenticatedRequest) {
    return this.purchaseOrders.deleteLine(req.auth!.tenantId, req.auth!.sub, id, lineId);
  }

  @Post(":id/submit")
  @RequirePermission("procurement.po.update")
  submit(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.submit(req.auth!.tenantId, req.auth!.sub, id);
  }

  // FR-PROC-3: "approval writes commitment atomically" (api.md §11).
  @Post(":id/approve")
  @RequirePermission("procurement.po.approve")
  approve(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.approve(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post(":id/send")
  @RequirePermission("procurement.po.update")
  send(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.send(req.auth!.tenantId, req.auth!.sub, id);
  }

  // Gap-fill (see PurchaseOrderLifecycleService's doc comment).
  @Post(":id/confirm")
  @RequirePermission("procurement.po.update")
  confirm(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.confirm(req.auth!.tenantId, req.auth!.sub, id);
  }

  // Gap-fill (see PurchaseOrderLifecycleService's doc comment).
  @Post(":id/close")
  @RequirePermission("procurement.po.update")
  close(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.close(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post(":id/cancel")
  @RequirePermission("procurement.po.cancel")
  cancel(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.cancel(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Get(":id/deliveries")
  @RequirePermission("procurement.delivery.read")
  listDeliveries(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.deliveries.listForPurchaseOrder(req.auth!.tenantId, id);
  }

  // api.md §11: "POST /purchase-orders/{id}/deliveries | Receipt (qty per
  // line, photos) -> stock + match state (FR-PROC-4)".
  @Post(":id/deliveries")
  @RequirePermission("procurement.delivery.create")
  @HttpCode(HttpStatus.CREATED)
  createDelivery(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createDeliverySchema)) body: z.infer<typeof createDeliverySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.deliveries.create(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
