import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  addAssemblyToEstimateSchema,
  batchCreateEstimateLinesSchema,
  createAssemblySchema,
  createCostItemSchema,
  createEstimateLineSchema,
  createEstimateSchema,
  listEstimatesQuerySchema,
  recordPriceObservationSchema,
  updateEstimateLineSchema,
  updateEstimateSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { CostBookService } from "../application/cost-book.service";
import { ConvertToBudgetService } from "../application/convert-to-budget.service";
import { EstimateLinesService } from "../application/estimate-lines.service";
import { EstimateService } from "../application/estimate.service";

@Controller()
export class EstimatingController {
  constructor(
    private readonly estimates: EstimateService,
    private readonly lines: EstimateLinesService,
    private readonly costBook: CostBookService,
    private readonly convertToBudget: ConvertToBudgetService,
  ) {}

  @Get("estimates")
  @RequirePermission("estimating.estimate.read")
  listEstimates(
    @Query(new ZodValidationPipe(listEstimatesQuerySchema)) query: z.infer<typeof listEstimatesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.estimates.list(req.auth!.tenantId, query);
  }

  @Post("estimates")
  @RequirePermission("estimating.estimate.create")
  @HttpCode(HttpStatus.CREATED)
  createEstimate(
    @Body(new ZodValidationPipe(createEstimateSchema)) body: z.infer<typeof createEstimateSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.estimates.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get("estimates/:id")
  @RequirePermission("estimating.estimate.read")
  getEstimate(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.estimates.getById(req.auth!.tenantId, id);
  }

  @Patch("estimates/:id")
  @RequirePermission("estimating.estimate.update")
  updateEstimate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEstimateSchema)) body: z.infer<typeof updateEstimateSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.estimates.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // FR-EST-4.
  @Post("estimates/:id/versions")
  @RequirePermission("estimating.estimate.create")
  @HttpCode(HttpStatus.CREATED)
  createVersion(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.estimates.createVersion(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post("estimates/:id/convert-to-budget")
  @RequirePermission("finance.budget.create")
  @HttpCode(HttpStatus.CREATED)
  convert(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.convertToBudget.convert(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post("estimates/:id/lines")
  @RequirePermission("estimating.estimate.update")
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createEstimateLineSchema)) body: z.infer<typeof createEstimateLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.lines.addLine(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // find-my-way (Fastify's router) treats a bare mid-segment ":" as a
  // parameter start, which would collide with the sibling
  // lines:from-assembly route below the moment both share an
  // identifier-only suffix; "::" escapes it to a literal colon (the path
  // clients actually call is still the literal api.md-documented
  // "lines:batch").
  @Post("estimates/:id/lines::batch")
  @RequirePermission("estimating.estimate.update")
  @HttpCode(HttpStatus.CREATED)
  batchAddLines(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(batchCreateEstimateLinesSchema)) body: z.infer<typeof batchCreateEstimateLinesSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.lines.batchAddLines(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // Gap-fill: not itemized in api.md §5 alongside /lines:batch, but
  // assemblies (database.md §10 "reusable build-ups") need a way to
  // explode into priced lines — same reasoning as the Budget module's
  // gap-fill endpoints. Mirrors the ":batch" action-suffix convention
  // api.md already uses for bulk line ops.
  @Post("estimates/:id/lines::from-assembly")
  @RequirePermission("estimating.estimate.update")
  @HttpCode(HttpStatus.CREATED)
  addAssemblyToEstimate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addAssemblyToEstimateSchema)) body: z.infer<typeof addAssemblyToEstimateSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.lines.addAssemblyToEstimate(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Patch("estimates/:id/lines/:lineId")
  @RequirePermission("estimating.estimate.update")
  updateLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(updateEstimateLineSchema)) body: z.infer<typeof updateEstimateLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.lines.updateLine(req.auth!.tenantId, req.auth!.sub, id, lineId, body);
  }

  @Delete("estimates/:id/lines/:lineId")
  @RequirePermission("estimating.estimate.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLine(@Param("id") id: string, @Param("lineId") lineId: string, @Req() req: AuthenticatedRequest) {
    return this.lines.deleteLine(req.auth!.tenantId, req.auth!.sub, id, lineId);
  }

  @Get("cost-items")
  @RequirePermission("estimating.costbook.read")
  listCostItems(@Req() req: AuthenticatedRequest) {
    return this.costBook.listCostItems(req.auth!.tenantId);
  }

  @Post("cost-items")
  @RequirePermission("estimating.costbook.manage")
  @HttpCode(HttpStatus.CREATED)
  createCostItem(
    @Body(new ZodValidationPipe(createCostItemSchema)) body: z.infer<typeof createCostItemSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.costBook.createCostItem(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get("cost-items/:id/price-history")
  @RequirePermission("estimating.costbook.read")
  listPriceHistory(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.costBook.listPriceHistory(req.auth!.tenantId, id);
  }

  // Gap-fill — api.md §5 only documents the GET ledger feed; see
  // cost-book.service.ts's recordPriceObservation for the same reasoning
  // as the Budget module's cost-transactions gap-fill.
  @Post("cost-items/:id/price-history")
  @RequirePermission("estimating.costbook.manage")
  @HttpCode(HttpStatus.CREATED)
  recordPriceObservation(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(recordPriceObservationSchema)) body: z.infer<typeof recordPriceObservationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.costBook.recordPriceObservation(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Get("assemblies")
  @RequirePermission("estimating.costbook.read")
  listAssemblies(@Req() req: AuthenticatedRequest) {
    return this.costBook.listAssemblies(req.auth!.tenantId);
  }

  @Post("assemblies")
  @RequirePermission("estimating.costbook.manage")
  @HttpCode(HttpStatus.CREATED)
  createAssembly(
    @Body(new ZodValidationPipe(createAssemblySchema)) body: z.infer<typeof createAssemblySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.costBook.createAssembly(req.auth!.tenantId, req.auth!.sub, body);
  }

  // Gap-fill — not itemized in api.md §5 but needed to view an assembly's
  // exploded items before adding it to an estimate.
  @Get("assemblies/:id")
  @RequirePermission("estimating.costbook.read")
  getAssembly(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.costBook.getAssembly(req.auth!.tenantId, id);
  }
}
