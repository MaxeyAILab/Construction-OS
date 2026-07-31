import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createCustomFieldAutomationSchema,
  createCustomFieldDefinitionSchema,
  listCustomFieldAutomationsQuerySchema,
  listCustomFieldDefinitionsQuerySchema,
  updateCustomFieldAutomationSchema,
  updateCustomFieldDefinitionSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { CustomFieldAutomationsService } from "../application/custom-field-automations.service";
import { CustomFieldDefinitionsService } from "../application/custom-field-definitions.service";

// api.md §19 (M18, FR-PLAT-11/12). Definitions and automations are
// admin.custom_field.manage-gated — unlike the values endpoints
// (CustomFieldValuesController), there's exactly one fixed permission
// here since "who may define a custom field" isn't entity-dependent the
// way "who may set one" is.
@Controller("admin/custom-fields")
export class CustomFieldAdminController {
  constructor(
    private readonly definitions: CustomFieldDefinitionsService,
    private readonly automations: CustomFieldAutomationsService,
  ) {}

  @Get("definitions")
  @RequirePermission("admin.custom_field.manage")
  listDefinitions(
    @Query(new ZodValidationPipe(listCustomFieldDefinitionsQuerySchema))
    query: z.infer<typeof listCustomFieldDefinitionsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.definitions.list(req.auth!.tenantId, query.entityType);
  }

  @Post("definitions")
  @RequirePermission("admin.custom_field.manage")
  createDefinition(
    @Body(new ZodValidationPipe(createCustomFieldDefinitionSchema))
    body: z.infer<typeof createCustomFieldDefinitionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.definitions.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Patch("definitions/:id")
  @RequirePermission("admin.custom_field.manage")
  updateDefinition(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCustomFieldDefinitionSchema))
    body: z.infer<typeof updateCustomFieldDefinitionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.definitions.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Get("automations")
  @RequirePermission("admin.custom_field.manage")
  listAutomations(
    @Query(new ZodValidationPipe(listCustomFieldAutomationsQuerySchema))
    query: z.infer<typeof listCustomFieldAutomationsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.automations.list(req.auth!.tenantId, query.entityType);
  }

  @Post("automations")
  @RequirePermission("admin.custom_field.manage")
  createAutomation(
    @Body(new ZodValidationPipe(createCustomFieldAutomationSchema))
    body: z.infer<typeof createCustomFieldAutomationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.automations.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Patch("automations/:id")
  @RequirePermission("admin.custom_field.manage")
  updateAutomation(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCustomFieldAutomationSchema))
    body: z.infer<typeof updateCustomFieldAutomationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.automations.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }
}
