import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createContactCompanySchema, listContactCompaniesQuerySchema, updateContactCompanySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ContactCompaniesService } from "../application/contact-companies.service";

// api.md §4: `/crm/companies` shares the crm.contact.* permission
// namespace with `/crm/contacts`.
@Controller("crm/companies")
export class ContactCompaniesController {
  constructor(private readonly contactCompanies: ContactCompaniesService) {}

  @Get()
  @RequirePermission("crm.contact.read")
  list(
    @Query(new ZodValidationPipe(listContactCompaniesQuerySchema)) query: z.infer<typeof listContactCompaniesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.contactCompanies.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("crm.contact.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createContactCompanySchema)) body: z.infer<typeof createContactCompanySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.contactCompanies.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("crm.contact.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.contactCompanies.getById(req.auth!.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission("crm.contact.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateContactCompanySchema)) body: z.infer<typeof updateContactCompanySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.contactCompanies.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Delete(":id")
  @RequirePermission("crm.contact.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.contactCompanies.remove(req.auth!.tenantId, req.auth!.sub, id);
  }
}
