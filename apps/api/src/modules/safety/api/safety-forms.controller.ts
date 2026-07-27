import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { createSafetyFormSchema, listSafetyFormsQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { SafetyFormsService } from "../application/safety-forms.service";

@Controller()
export class SafetyFormsController {
  constructor(private readonly forms: SafetyFormsService) {}

  @Get("projects/:id/safety-forms")
  @RequirePermission("safety.form.read")
  list(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listSafetyFormsQuerySchema)) query: z.infer<typeof listSafetyFormsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.forms.listForProject(req.auth!.tenantId, projectId, query);
  }

  // FR-SAFE-1: field-captured, offline-first — client callers normally
  // write via the sync protocol (which passes its own client-minted id);
  // this REST path serves office views/integrations, same "same use-case
  // underneath" note as api.md §9's Field API.
  @Post("projects/:id/safety-forms")
  @RequirePermission("safety.form.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createSafetyFormSchema)) body: z.infer<typeof createSafetyFormSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.forms.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }
}
