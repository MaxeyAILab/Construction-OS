import { Body, Controller, Get, Put, Query, Req } from "@nestjs/common";
import { listCustomFieldValuesQuerySchema, upsertCustomFieldValueSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { CustomFieldValuesService } from "../application/custom-field-values.service";

// api.md §19: @Authenticated() only, same "no single fixed permission
// fits" shape as SyncController/SchedulingController's getActiveSchedule()
// — a request can target any allow-listed entity_type, each gated by that
// entity's own permission, resolved inside CustomFieldValuesService
// (which throws PermissionDeniedError naming the real requirement).
@Controller("custom-fields/values")
export class CustomFieldValuesController {
  constructor(private readonly values: CustomFieldValuesService) {}

  @Get()
  @Authenticated()
  list(
    @Query(new ZodValidationPipe(listCustomFieldValuesQuerySchema))
    query: z.infer<typeof listCustomFieldValuesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.values.list(req.auth!.tenantId, req.auth!.sub, query.entityType, query.entityId);
  }

  @Put()
  @Authenticated()
  setValue(
    @Body(new ZodValidationPipe(upsertCustomFieldValueSchema)) body: z.infer<typeof upsertCustomFieldValueSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.values.setValue(req.auth!.tenantId, req.auth!.sub, body);
  }
}
