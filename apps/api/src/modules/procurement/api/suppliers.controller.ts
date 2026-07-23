import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createSupplierSchema, listSuppliersQuerySchema, updateSupplierSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SuppliersService } from "../application/suppliers.service";

@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

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
}
