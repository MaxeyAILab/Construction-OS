import { Body, Controller, Post, Req } from "@nestjs/common";
import { searchQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { RagSearchService } from "../application/rag-search.service";

// api.md §13: `POST /ai/search`. Same "ai" module namespace as
// modules/ai's ai.run.read permission.
@Controller("ai")
export class RagSearchController {
  constructor(private readonly ragSearch: RagSearchService) {}

  @Post("search")
  @RequirePermission("ai.search.read")
  search(
    @Body(new ZodValidationPipe(searchQuerySchema)) body: z.infer<typeof searchQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ragSearch.search(req.auth!.tenantId, req.auth!.sub, body);
  }
}
