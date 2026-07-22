import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createChangeOrderLineSchema,
  createChangeOrderSchema,
  listChangeOrdersQuerySchema,
  updateChangeOrderLineSchema,
  updateChangeOrderSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ChangeOrderLifecycleService } from "../application/change-order-lifecycle.service";
import { ChangeOrdersService } from "../application/change-orders.service";

@Controller()
export class ChangeOrdersController {
  constructor(
    private readonly changeOrders: ChangeOrdersService,
    private readonly lifecycle: ChangeOrderLifecycleService,
  ) {}

  @Get("projects/:id/change-orders")
  @RequirePermission("finance.co.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listChangeOrdersQuerySchema)) query: z.infer<typeof listChangeOrdersQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeOrders.list(req.auth!.tenantId, projectId, query);
  }

  @Post("projects/:id/change-orders")
  @RequirePermission("finance.co.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createChangeOrderSchema)) body: z.infer<typeof createChangeOrderSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeOrders.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("change-orders/:id")
  @RequirePermission("finance.co.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.changeOrders.getById(req.auth!.tenantId, id);
  }

  @Patch("change-orders/:id")
  @RequirePermission("finance.co.update")
  updateHeader(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateChangeOrderSchema)) body: z.infer<typeof updateChangeOrderSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeOrders.updateHeader(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post("change-orders/:id/lines")
  @RequirePermission("finance.co.update")
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createChangeOrderLineSchema)) body: z.infer<typeof createChangeOrderLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeOrders.addLine(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Patch("change-orders/:id/lines/:lineId")
  @RequirePermission("finance.co.update")
  updateLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(updateChangeOrderLineSchema)) body: z.infer<typeof updateChangeOrderLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeOrders.updateLine(req.auth!.tenantId, req.auth!.sub, id, lineId, body);
  }

  @Delete("change-orders/:id/lines/:lineId")
  @RequirePermission("finance.co.update")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLine(@Param("id") id: string, @Param("lineId") lineId: string, @Req() req: AuthenticatedRequest) {
    return this.changeOrders.deleteLine(req.auth!.tenantId, req.auth!.sub, id, lineId);
  }

  @Post("change-orders/:id/submit-to-client")
  @RequirePermission("finance.co.submit")
  submitToClient(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.submitToClient(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post("change-orders/:id/approve")
  @RequirePermission("finance.co.approve")
  approve(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.approve(req.auth!.tenantId, req.auth!.sub, id);
  }

  // Gap-fill (see ChangeOrderLifecycleService.reject's doc comment).
  @Post("change-orders/:id/reject")
  @RequirePermission("finance.co.approve")
  reject(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.reject(req.auth!.tenantId, req.auth!.sub, id);
  }

  // Gap-fill (see ChangeOrderLifecycleService.void's doc comment).
  @Post("change-orders/:id/void")
  @RequirePermission("finance.co.update")
  void(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.lifecycle.void(req.auth!.tenantId, req.auth!.sub, id);
  }
}
