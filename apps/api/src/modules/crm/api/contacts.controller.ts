import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { createContactSchema, listContactsQuerySchema, updateContactSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ContactsService } from "../application/contacts.service";

// api.md §4 (M1 CRM, FR-CRM-1/2).
@Controller("crm/contacts")
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermission("crm.contact.read")
  list(
    @Query(new ZodValidationPipe(listContactsQuerySchema)) query: z.infer<typeof listContactsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.contacts.list(req.auth!.tenantId, query);
  }

  @Post()
  @RequirePermission("crm.contact.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createContactSchema)) body: z.infer<typeof createContactSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.contacts.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("crm.contact.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.contacts.getById(req.auth!.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission("crm.contact.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateContactSchema)) body: z.infer<typeof updateContactSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.contacts.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Delete(":id")
  @RequirePermission("crm.contact.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.contacts.remove(req.auth!.tenantId, req.auth!.sub, id);
  }
}
