import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { createRfqSchema, createSupplierQuoteSchema, listRfqsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { RfqsService } from "../application/rfqs.service";

@Controller("rfqs")
export class RfqsController {
  constructor(private readonly rfqs: RfqsService) {}

  @Get()
  @RequirePermission("procurement.rfq.read")
  list(
    @Query(new ZodValidationPipe(listRfqsQuerySchema)) query: z.infer<typeof listRfqsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rfqs.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("procurement.rfq.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createRfqSchema)) body: z.infer<typeof createRfqSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rfqs.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("procurement.rfq.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.rfqs.getById(req.auth!.tenantId, id);
  }

  @Get(":id/quotes")
  @RequirePermission("procurement.rfq.read")
  listQuotes(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.rfqs.listQuotes(req.auth!.tenantId, id);
  }

  @Post(":id/quotes")
  @RequirePermission("procurement.rfq.create")
  @HttpCode(HttpStatus.CREATED)
  createQuote(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createSupplierQuoteSchema)) body: z.infer<typeof createSupplierQuoteSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rfqs.createQuote(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
