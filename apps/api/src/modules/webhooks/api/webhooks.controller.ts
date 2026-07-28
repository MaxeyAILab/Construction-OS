import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createWebhookEndpointSchema,
  listWebhookDeliveriesQuerySchema,
  updateWebhookEndpointSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { WebhooksService } from "../application/webhooks.service";

// api.md §16.3: "GET/POST/PATCH/DELETE /webhooks | Endpoint CRUD ... GET
// /webhooks/{id}/deliveries | Attempt log ... POST /webhooks/{id}/test."
// No permission column shown for this section — see the migration 0109
// doc comment for why admin.webhook.manage gates all six routes here.
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermission("admin.webhook.manage")
  list(@Req() req: AuthenticatedRequest) {
    return this.webhooks.list(req.auth!.tenantId);
  }

  @Post()
  @RequirePermission("admin.webhook.manage")
  create(
    @Body(new ZodValidationPipe(createWebhookEndpointSchema)) body: z.infer<typeof createWebhookEndpointSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhooks.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Patch(":id")
  @RequirePermission("admin.webhook.manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWebhookEndpointSchema)) body: z.infer<typeof updateWebhookEndpointSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhooks.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Delete(":id")
  @RequirePermission("admin.webhook.manage")
  delete(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.webhooks.delete(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Get(":id/deliveries")
  @RequirePermission("admin.webhook.manage")
  listDeliveries(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(listWebhookDeliveriesQuerySchema)) query: z.infer<typeof listWebhookDeliveriesQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhooks.listDeliveries(req.auth!.tenantId, id, query);
  }

  @Post(":id/test")
  @RequirePermission("admin.webhook.manage")
  test(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.webhooks.test(req.auth!.tenantId, id);
  }
}
