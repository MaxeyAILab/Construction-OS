import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { createSafetyFormTemplateSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SafetyFormTemplatesService } from "../application/safety-form-templates.service";

// api.md has no dedicated Safety section (unlike M5/M10/M11's §11) — this
// route shape follows the same module.resource nesting every other
// module's own api.md bullet establishes, applied to database.md §15's
// documented entities.
@Controller("safety/form-templates")
export class SafetyFormTemplatesController {
  constructor(private readonly templates: SafetyFormTemplatesService) {}

  @Get()
  @RequirePermission("safety.form_template.read")
  list(@Req() req: AuthenticatedRequest) {
    return this.templates.list(req.auth!.tenantId);
  }

  @Post()
  @RequirePermission("safety.form_template.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createSafetyFormTemplateSchema)) body: z.infer<typeof createSafetyFormTemplateSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.templates.create(req.auth!.tenantId, req.auth!.sub, body);
  }
}
