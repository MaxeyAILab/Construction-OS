import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  assignRoleSchema,
  createRoleSchema,
  grantPermissionSchema,
  inviteUserSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RbacService } from "../application/rbac.service";
import { RequirePermission } from "./require-permission.decorator";

@Controller("rbac")
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

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

  @Post("roles/:roleId/permissions")
  @RequirePermission("platform.role.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async grantPermission(
    @Param("roleId") roleId: string,
    @Body(new ZodValidationPipe(grantPermissionSchema)) body: z.infer<typeof grantPermissionSchema>,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.rbac.grantPermissionToRole(
      req.auth!.tenantId,
      roleId,
      body.permissionKey,
      req.auth!.sub,
    );
  }

  @Delete("roles/:roleId/permissions/:permissionKey")
  @RequirePermission("platform.role.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokePermission(
    @Param("roleId") roleId: string,
    @Param("permissionKey") permissionKey: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.rbac.revokePermissionFromRole(
      req.auth!.tenantId,
      roleId,
      permissionKey,
      req.auth!.sub,
    );
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
  @HttpCode(HttpStatus.NO_CONTENT)
  async assignRole(
    @Body(new ZodValidationPipe(assignRoleSchema)) body: z.infer<typeof assignRoleSchema>,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.rbac.assignRole(
      req.auth!.tenantId,
      body.userId,
      body.roleId,
      { scopeType: body.scopeType, projectId: body.projectId },
      req.auth!.sub,
    );
  }

  @Delete("user-roles/:userId/:roleId")
  @RequirePermission("platform.user_role.revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeRole(
    @Param("userId") userId: string,
    @Param("roleId") roleId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.rbac.revokeRole(req.auth!.tenantId, userId, roleId, req.auth!.sub);
  }
}
