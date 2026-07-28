import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { createApiKeySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import { RequirePermission } from "../../rbac";
import { ApiKeysService } from "../application/api-keys.service";
import type { AuthenticatedRequest } from "./access-token.guard";

// api.md §16.4: "Public API: API keys" — GET/POST /api-keys, DELETE
// /api-keys/{id}, all gated by admin.apikey.manage (NFR-23).
@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @RequirePermission("admin.apikey.manage")
  list(@Req() req: AuthenticatedRequest) {
    return this.apiKeys.list(req.auth!.tenantId);
  }

  @Post()
  @RequirePermission("admin.apikey.manage")
  create(
    @Body(new ZodValidationPipe(createApiKeySchema)) body: z.infer<typeof createApiKeySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.apiKeys.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Delete(":id")
  @RequirePermission("admin.apikey.manage")
  revoke(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.apiKeys.revoke(req.auth!.tenantId, req.auth!.sub, id);
  }
}
