import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSION_KEY = "requiredPermission";

// api.md §1.1 / architecture.md §12 / FR-RBAC-1: every endpoint declares a
// module.resource.action permission, enforced deny-by-default by
// PermissionGuard. Use @Public() or @Authenticated() for endpoints that
// deliberately don't need one.
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
