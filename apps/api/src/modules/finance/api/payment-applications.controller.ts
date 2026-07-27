import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { createPaymentApplicationLineSchema, createPaymentApplicationSchema, listPaymentApplicationsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { PaymentApplicationsService } from "../application/payment-applications.service";

// api.md §10: "GET/POST /projects/{id}/payment-applications |
// finance.payapp.* | AIA-style billing (FR-FIN-4); POST {id}/generate-pdf
// -> 202". Route shape mirrors ChangeOrdersController: project-scoped
// list/create, flat payment-applications/:id for item routes.
@Controller()
export class PaymentApplicationsController {
  constructor(private readonly paymentApplications: PaymentApplicationsService) {}

  @Get("projects/:id/payment-applications")
  @RequirePermission("finance.payapp.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listPaymentApplicationsQuerySchema)) query: z.infer<typeof listPaymentApplicationsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.paymentApplications.listForProject(req.auth!.tenantId, projectId, query);
  }

  @Post("projects/:id/payment-applications")
  @RequirePermission("finance.payapp.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createPaymentApplicationSchema)) body: z.infer<typeof createPaymentApplicationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.paymentApplications.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("payment-applications/:id")
  @RequirePermission("finance.payapp.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.paymentApplications.getById(req.auth!.tenantId, id);
  }

  @Post("payment-applications/:id/lines")
  @RequirePermission("finance.payapp.create")
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createPaymentApplicationLineSchema)) body: z.infer<typeof createPaymentApplicationLineSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.paymentApplications.addLine(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post("payment-applications/:id/submit")
  @RequirePermission("finance.payapp.create")
  submit(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.paymentApplications.submit(req.auth!.tenantId, req.auth!.sub, id);
  }

  // FR-FIN-4: bills the project's client via a real receivable invoice.
  @Post("payment-applications/:id/approve")
  @RequirePermission("finance.payapp.approve")
  approve(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.paymentApplications.approve(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post("payment-applications/:id/void")
  @RequirePermission("finance.payapp.approve")
  void_(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.paymentApplications.void(req.auth!.tenantId, req.auth!.sub, id);
  }

  // api.md §10: "POST {id}/generate-pdf -> 202" — enqueue-and-poll.
  @Post("payment-applications/:id/generate-pdf")
  @RequirePermission("finance.payapp.read")
  @HttpCode(HttpStatus.ACCEPTED)
  generatePdf(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.paymentApplications.requestPdf(req.auth!.tenantId, req.auth!.sub, id);
  }
}
