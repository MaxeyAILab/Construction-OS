import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  assignRoleSchema,
  createRoleSchema,
  grantPermissionSchema,
  inviteUserSchema,
  listPermissionChangeRequestsQuerySchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import type { AuthenticatedRequest } from "../../auth";
import { PermissionChangeRequestsService } from "../application/permission-change-requests.service";
import { RbacService } from "../application/rbac.service";
import { RequirePermission } from "./require-permission.decorator";

@Controller("rbac")
export class RbacController {
  constructor(
    private readonly rbac: RbacService,
    private readonly permissionChangeRequests: PermissionChangeRequestsService,
  ) {}

  @Get("roles")
  @RequirePermission("platform.role.read")
  listRoles(@Req() req: AuthenticatedRequest) {
    return this.rbac.listRoles(req.auth!.tenantId);
  }

  @Get("permissions")
  @RequirePermission("platform.role.read")
  listPermissionCatalog() {
    return this.rbac.listPermissionCatalog();
  }

  @Post("roles")
  @RequirePermission("platform.role.manage")
  createRole(
    @Body(new ZodValidationPipe(createRoleSchema)) body: z.infer<typeof createRoleSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rbac.createRole(req.auth!.tenantId, body.name, req.auth!.sub);
  }

  // spec.md §10.2 (Segregation of duties): when the tenant has
  // companies.settings.enforceMakerChecker on, this queues a
  // permission_change_requests row (approved separately by a different
  // admin) instead of applying immediately — see
  // PermissionChangeRequestsService's doc comment for the full design.
  @Post("roles/:roleId/permissions")
  @RequirePermission("platform.role.manage")
  async grantPermission(
    @Param("roleId") roleId: string,
    @Body(new ZodValidationPipe(grantPermissionSchema)) body: z.infer<typeof grantPermissionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    if (await this.permissionChangeRequests.isEnabled(req.auth!.tenantId)) {
      return {
        status: "pending" as const,
        request: await this.permissionChangeRequests.request(req.auth!.tenantId, req.auth!.sub, "grant_permission", {
          roleId,
          permissionKey: body.permissionKey,
        }),
      };
    }
    await this.rbac.grantPermissionToRole(req.auth!.tenantId, roleId, body.permissionKey, req.auth!.sub);
    return { status: "applied" as const };
  }

  @Delete("roles/:roleId/permissions/:permissionKey")
  @RequirePermission("platform.role.manage")
  async revokePermission(
    @Param("roleId") roleId: string,
    @Param("permissionKey") permissionKey: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (await this.permissionChangeRequests.isEnabled(req.auth!.tenantId)) {
      return {
        status: "pending" as const,
        request: await this.permissionChangeRequests.request(req.auth!.tenantId, req.auth!.sub, "revoke_permission", {
          roleId,
          permissionKey,
        }),
      };
    }
    await this.rbac.revokePermissionFromRole(req.auth!.tenantId, roleId, permissionKey, req.auth!.sub);
    return { status: "applied" as const };
  }

  @Post("company-users")
  @RequirePermission("platform.company_user.invite")
  inviteUser(
    @Body(new ZodValidationPipe(inviteUserSchema)) body: z.infer<typeof inviteUserSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rbac.inviteUser(req.auth!.tenantId, body.email, body.fullName, req.auth!.sub, body.kind);
  }

  @Delete("company-users/:userId")
  @RequirePermission("platform.company_user.remove")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeUser(
    @Param("userId") userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.rbac.removeUser(req.auth!.tenantId, userId, req.auth!.sub);
  }

  @Post("user-roles")
  @RequirePermission("platform.user_role.assign")
  async assignRole(
    @Body(new ZodValidationPipe(assignRoleSchema)) body: z.infer<typeof assignRoleSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    if (await this.permissionChangeRequests.isEnabled(req.auth!.tenantId)) {
      return {
        status: "pending" as const,
        request: await this.permissionChangeRequests.request(req.auth!.tenantId, req.auth!.sub, "assign_role", {
          userId: body.userId,
          roleId: body.roleId,
          scopeType: body.scopeType,
          projectId: body.projectId,
        }),
      };
    }
    await this.rbac.assignRole(
      req.auth!.tenantId,
      body.userId,
      body.roleId,
      { scopeType: body.scopeType, projectId: body.projectId },
      req.auth!.sub,
    );
    return { status: "applied" as const };
  }

  @Delete("user-roles/:userId/:roleId")
  @RequirePermission("platform.user_role.revoke")
  async revokeRole(
    @Param("userId") userId: string,
    @Param("roleId") roleId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (await this.permissionChangeRequests.isEnabled(req.auth!.tenantId)) {
      return {
        status: "pending" as const,
        request: await this.permissionChangeRequests.request(req.auth!.tenantId, req.auth!.sub, "revoke_role", {
          userId,
          roleId,
        }),
      };
    }
    await this.rbac.revokeRole(req.auth!.tenantId, userId, roleId, req.auth!.sub);
    return { status: "applied" as const };
  }

  @Get("permission-change-requests")
  @RequirePermission("platform.role.read")
  listPermissionChangeRequests(
    @Query(new ZodValidationPipe(listPermissionChangeRequestsQuerySchema))
    query: z.infer<typeof listPermissionChangeRequestsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionChangeRequests.list(req.auth!.tenantId, query);
  }

  // No fixed @RequirePermission: the required permission depends on the
  // request's actionType (same permission the underlying action itself
  // needs) and is checked inside the service — same @Authenticated()-plus-
  // internal-check pattern as ChangeOrderLifecycleService.approve().
  @Post("permission-change-requests/:id/approve")
  @Authenticated()
  approvePermissionChangeRequest(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.permissionChangeRequests.approve(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post("permission-change-requests/:id/reject")
  @Authenticated()
  rejectPermissionChangeRequest(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.permissionChangeRequests.reject(req.auth!.tenantId, req.auth!.sub, id);
  }
}
