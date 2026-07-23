import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { createTimeEntrySchema, listTimeEntriesQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { TimeEntriesService } from "../application/time-entries.service";

// api.md conventions (M8 Field Operations). FR-FIELD-2.
@Controller("time-entries")
export class TimeEntriesController {
  constructor(private readonly timeEntries: TimeEntriesService) {}

  @Get()
  @RequirePermission("field.time_entry.read")
  list(
    @Query(new ZodValidationPipe(listTimeEntriesQuerySchema)) query: z.infer<typeof listTimeEntriesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.timeEntries.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("field.time_entry.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createTimeEntrySchema)) body: z.infer<typeof createTimeEntrySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.timeEntries.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("field.time_entry.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.timeEntries.getById(req.auth!.tenantId, id);
  }

  @Post(":id/approve")
  @RequirePermission("field.time_entry.approve")
  approve(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.timeEntries.approve(req.auth!.tenantId, req.auth!.sub, id);
  }
}
