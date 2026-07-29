import { Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { CloseoutPackagesService } from "../application/closeout-packages.service";

// api.md §18 (FR-CLOSE-2/3). Double colon in the route (::assemble) is
// path-to-regexp escaping for a literal ':' — same
// "resource:custom-action" convention as procurement's
// purchase-orders::draft-from-needs.
@Controller()
export class CloseoutPackagesController {
  constructor(private readonly packages: CloseoutPackagesService) {}

  @Get("projects/:id/closeout/package")
  @RequirePermission("closeout.package.read")
  getStatus(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.packages.getStatus(req.auth!.tenantId, projectId);
  }

  @Post("projects/:id/closeout/package::assemble")
  @RequirePermission("closeout.package.assemble")
  assemble(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.packages.assemble(req.auth!.tenantId, req.auth!.sub, projectId);
  }
}
