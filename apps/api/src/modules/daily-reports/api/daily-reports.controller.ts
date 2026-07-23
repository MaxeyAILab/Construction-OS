import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createDailyReportSchema, listDailyReportsQuerySchema, updateDailyReportSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { DailyReportsService } from "../application/daily-reports.service";

// api.md conventions (M8 Field Operations). FR-FIELD-1.
@Controller("daily-reports")
export class DailyReportsController {
  constructor(private readonly dailyReports: DailyReportsService) {}

  @Get()
  @RequirePermission("field.daily_report.read")
  list(
    @Query(new ZodValidationPipe(listDailyReportsQuerySchema)) query: z.infer<typeof listDailyReportsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dailyReports.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("field.daily_report.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createDailyReportSchema)) body: z.infer<typeof createDailyReportSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dailyReports.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("field.daily_report.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.dailyReports.getById(req.auth!.tenantId, id);
  }

  // A body of { status: 'submitted' } is the submit transition — see
  // DailyReportsService.update's comment for why this isn't a separate
  // action endpoint.
  @Patch(":id")
  @RequirePermission("field.daily_report.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDailyReportSchema)) body: z.infer<typeof updateDailyReportSchema>,
    @Headers("if-match") ifMatch: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const version = ifMatch !== undefined ? Number.parseInt(ifMatch, 10) : undefined;
    return this.dailyReports.update(req.auth!.tenantId, req.auth!.sub, id, body, version);
  }
}
