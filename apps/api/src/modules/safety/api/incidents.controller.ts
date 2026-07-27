import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createIncidentSchema,
  listIncidentsQuerySchema,
  routeIncidentCorrectiveActionSchema,
  updateIncidentSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { IncidentsService } from "../application/incidents.service";

@Controller()
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get("projects/:id/incidents")
  @RequirePermission("safety.incident.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listIncidentsQuerySchema)) query: z.infer<typeof listIncidentsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.incidents.listForProject(req.auth!.tenantId, projectId, query);
  }

  @Post("projects/:id/incidents")
  @RequirePermission("safety.incident.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createIncidentSchema)) body: z.infer<typeof createIncidentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.incidents.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("incidents/:id")
  @RequirePermission("safety.incident.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.incidents.getById(req.auth!.tenantId, id);
  }

  @Patch("incidents/:id")
  @RequirePermission("safety.incident.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateIncidentSchema)) body: z.infer<typeof updateIncidentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.incidents.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // FR-SAFE-3: gap-fill lifecycle action (see IncidentsService's doc
  // comment) — creates the corrective-action Task and links it back.
  @Post("incidents/:id/route-corrective-action")
  @RequirePermission("safety.incident.update")
  routeCorrectiveAction(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(routeIncidentCorrectiveActionSchema))
    body: z.infer<typeof routeIncidentCorrectiveActionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.incidents.routeCorrectiveAction(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
