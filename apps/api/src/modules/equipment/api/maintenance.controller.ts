import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import {
  createEquipmentInspectionSchema,
  createMaintenanceScheduleSchema,
  createMaintenanceWorkOrderSchema,
  updateMaintenanceWorkOrderSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { MaintenanceService } from "../application/maintenance.service";

// api.md §11: "GET/POST /equipment/{id}/maintenance | Schedules, work
// orders, inspections (FR-EQ-3)" — one documented bullet, expanded into
// concrete sub-resource routes the same way Inventory's "GET/POST
// /inventory/items · /inventory/locations" bullet became two controllers.
// GET /equipment/{id}/maintenance is the combined overview (due-state
// projection included); creation goes to the specific sub-resource.
@Controller("equipment/:id/maintenance")
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermission("equipment.maintenance.read")
  async getOverview(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const [schedules, workOrders, inspections] = await Promise.all([
      this.maintenance.listSchedules(req.auth!.tenantId, id),
      this.maintenance.listWorkOrders(req.auth!.tenantId, id),
      this.maintenance.listInspections(req.auth!.tenantId, id),
    ]);
    return { schedules, workOrders, inspections };
  }

  @Post("schedules")
  @RequirePermission("equipment.maintenance.create")
  createSchedule(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createMaintenanceScheduleSchema)) body: z.infer<typeof createMaintenanceScheduleSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.maintenance.createSchedule(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post("work-orders")
  @RequirePermission("equipment.maintenance.create")
  createWorkOrder(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createMaintenanceWorkOrderSchema)) body: z.infer<typeof createMaintenanceWorkOrderSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.maintenance.createWorkOrder(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Patch("work-orders/:workOrderId")
  @RequirePermission("equipment.maintenance.create")
  updateWorkOrder(
    @Param("id") id: string,
    @Param("workOrderId") workOrderId: string,
    @Body(new ZodValidationPipe(updateMaintenanceWorkOrderSchema)) body: z.infer<typeof updateMaintenanceWorkOrderSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.maintenance.updateWorkOrder(req.auth!.tenantId, req.auth!.sub, id, workOrderId, body);
  }

  @Post("inspections")
  @RequirePermission("equipment.maintenance.create")
  createInspection(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createEquipmentInspectionSchema)) body: z.infer<typeof createEquipmentInspectionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.maintenance.createInspection(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
