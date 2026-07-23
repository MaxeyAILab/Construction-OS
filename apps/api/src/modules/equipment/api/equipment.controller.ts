import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createEquipmentAssignmentSchema,
  createEquipmentSchema,
  createEquipmentUsageLogSchema,
  listEquipmentQuerySchema,
  listEquipmentUsageLogsQuerySchema,
  updateEquipmentSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { EquipmentAssignmentsService } from "../application/equipment-assignments.service";
import { EquipmentUsageLogsService } from "../application/equipment-usage-logs.service";
import { EquipmentService } from "../application/equipment.service";

// api.md §11 (M11 Equipment): "GET/POST/PATCH /equipment | Registry
// (FR-EQ-1)", "POST /equipment/{id}/assignments | 409 overlap on
// double-book (DB exclusion)", "POST /equipment/{id}/usage-logs |
// Hours/odometer -> cost allocation (FR-EQ-2)".
@Controller("equipment")
export class EquipmentController {
  constructor(
    private readonly equipment: EquipmentService,
    private readonly assignments: EquipmentAssignmentsService,
    private readonly usageLogs: EquipmentUsageLogsService,
  ) {}

  @Get()
  @RequirePermission("equipment.equipment.read")
  list(
    @Query(new ZodValidationPipe(listEquipmentQuerySchema)) query: z.infer<typeof listEquipmentQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.equipment.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("equipment.equipment.create")
  create(
    @Body(new ZodValidationPipe(createEquipmentSchema)) body: z.infer<typeof createEquipmentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.equipment.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("equipment.equipment.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.equipment.getById(req.auth!.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission("equipment.equipment.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEquipmentSchema)) body: z.infer<typeof updateEquipmentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.equipment.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Get(":id/assignments")
  @RequirePermission("equipment.assignment.read")
  listAssignments(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.assignments.listForEquipment(req.auth!.tenantId, id);
  }

  @Post(":id/assignments")
  @RequirePermission("equipment.assignment.create")
  createAssignment(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createEquipmentAssignmentSchema)) body: z.infer<typeof createEquipmentAssignmentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.assignments.create(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // Gap-fill (see EquipmentAssignmentsService.end's doc comment).
  @Post(":id/assignments/:assignmentId/end")
  @RequirePermission("equipment.assignment.create")
  endAssignment(
    @Param("id") id: string,
    @Param("assignmentId") assignmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.assignments.end(req.auth!.tenantId, req.auth!.sub, id, assignmentId);
  }

  @Get(":id/usage-logs")
  @RequirePermission("equipment.usage.read")
  listUsageLogs(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(listEquipmentUsageLogsQuerySchema)) query: z.infer<typeof listEquipmentUsageLogsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usageLogs.listForEquipment(req.auth!.tenantId, id, query);
  }

  @Post(":id/usage-logs")
  @RequirePermission("equipment.usage.create")
  createUsageLog(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createEquipmentUsageLogSchema)) body: z.infer<typeof createEquipmentUsageLogSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usageLogs.create(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
