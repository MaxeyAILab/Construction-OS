import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from "@nestjs/common";
import {
  createBudgetLineSchema,
  createBudgetSchema,
  createManualCostTransactionSchema,
  updateBudgetLineSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { BudgetService } from "../application/budget.service";
import { CostTransactionsService } from "../application/cost-transactions.service";
import { FinancialSummaryService } from "../application/financial-summary.service";

@Controller()
export class BudgetsController {
  constructor(
    private readonly budgets: BudgetService,
    private readonly costTransactions: CostTransactionsService,
    private readonly summary: FinancialSummaryService,
  ) {}

  // Not documented in api.md §10 (which assumes a budget already exists)
  // — a necessary gap-fill, same reasoning as /project-templates: without
  // it there's no way to create the one-per-project budget FR-FIN-1
  // depends on. Estimating (M2) would normally seed this; it doesn't
  // exist yet.
  @Post("projects/:id/budget")
  @RequirePermission("finance.budget.update")
  @HttpCode(HttpStatus.CREATED)
  createBudget(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createBudgetSchema)) body: z.infer<typeof createBudgetSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.budgets.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("projects/:id/budget")
  @RequirePermission("finance.budget.read")
  getBudget(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.budgets.getByProject(req.auth!.tenantId, projectId);
  }

  // Gap-fill (see createBudget) — api.md only documents PATCHing an
  // existing line, not creating one.
  @Post("budgets/:id/lines")
  @RequirePermission("finance.budget.update")
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @Param("id") budgetId: string,
    @Body(new ZodValidationPipe(createBudgetLineSchema)) body: z.infer<typeof createBudgetLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.budgets.addLine(req.auth!.tenantId, req.auth!.sub, budgetId, body);
  }

  @Patch("budgets/:id/lines/:lineId")
  @RequirePermission("finance.budget.update")
  updateLine(
    @Param("id") budgetId: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(updateBudgetLineSchema)) body: z.infer<typeof updateBudgetLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.budgets.updateLineOriginalAmount(req.auth!.tenantId, req.auth!.sub, budgetId, lineId, body);
  }

  @Get("projects/:id/financial-summary")
  @RequirePermission("finance.budget.read")
  getFinancialSummary(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.summary.get(req.auth!.tenantId, projectId);
  }

  // Gap-fill — api.md doesn't document a cost-transaction endpoint at all
  // (the ledger is meant to be written by Procurement/Field/Equipment/
  // accounting-sync, none of which exist yet); manual entry is the only
  // way to exercise the ledger today.
  @Get("projects/:id/cost-transactions")
  @RequirePermission("finance.budget.read")
  listCostTransactions(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.costTransactions.list(req.auth!.tenantId, projectId);
  }

  @Post("projects/:id/cost-transactions")
  @RequirePermission("finance.costtxn.create")
  @HttpCode(HttpStatus.CREATED)
  postCostTransaction(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createManualCostTransactionSchema))
    body: z.infer<typeof createManualCostTransactionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.costTransactions.postManual(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }
}
