import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { createInvoiceLineSchema, createInvoiceSchema, createPaymentSchema, listInvoicesQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { InvoicesService } from "../application/invoices.service";
import { PaymentsService } from "../application/payments.service";

// api.md §10: "GET/POST /invoices | finance.invoice.* | AP+AR unified...
// POST /invoices/{id}/approve -> /payments | finance.invoice.approve /
// finance.payment.*."
@Controller("invoices")
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @RequirePermission("finance.invoice.read")
  list(
    @Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: z.infer<typeof listInvoicesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.invoices.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("finance.invoice.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: z.infer<typeof createInvoiceSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.invoices.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("finance.invoice.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.invoices.getById(req.auth!.tenantId, id);
  }

  @Post(":id/lines")
  @RequirePermission("finance.invoice.create")
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createInvoiceLineSchema)) body: z.infer<typeof createInvoiceLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.invoices.addLine(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // FR-VEND-2: blocks with a 422 if the invoice has a mismatched line.
  @Post(":id/approve")
  @RequirePermission("finance.invoice.approve")
  approve(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.invoices.approve(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post(":id/void")
  @RequirePermission("finance.invoice.approve")
  void_(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.invoices.void(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Get(":id/payments")
  @RequirePermission("finance.invoice.read")
  listPayments(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.payments.listForInvoice(req.auth!.tenantId, id);
  }

  @Post(":id/payments")
  @RequirePermission("finance.payment.create")
  @HttpCode(HttpStatus.CREATED)
  createPayment(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createPaymentSchema)) body: z.infer<typeof createPaymentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.payments.create(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
