import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createSupplierSchema, listSuppliersQuerySchema, updateSupplierSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SuppliersService } from "../application/suppliers.service";
import { SupplierScoringService } from "../application/supplier-scoring.service";

@Controller("suppliers")
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly scoring: SupplierScoringService,
  ) {}

  @Get()
  @RequirePermission("procurement.supplier.read")
  list(
    @Query(new ZodValidationPipe(listSuppliersQuerySchema)) query: z.infer<typeof listSuppliersQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.suppliers.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("procurement.supplier.create")
  create(
    @Body(new ZodValidationPipe(createSupplierSchema)) body: z.infer<typeof createSupplierSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.suppliers.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("procurement.supplier.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.suppliers.getById(req.auth!.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission("procurement.supplier.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: z.infer<typeof updateSupplierSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.suppliers.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // Gap-fill — api.md §11 mentions `expand=rating` on the registry read
  // but never itemizes a write path for it; this is that write path
  // (FR-PROC-5), same "the model requires it, add it" precedent as every
  // other gap-fill action this session.
  @Post(":id/ai/rescore")
  @RequirePermission("procurement.supplier.update")
  rescore(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.scoring.rescore(req.auth!.tenantId, req.auth!.sub, id);
  }
}
