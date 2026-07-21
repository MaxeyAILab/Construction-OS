import { SetMetadata } from "@nestjs/common";

export const IS_AUTHENTICATED_ONLY_KEY = "isAuthenticatedOnly";

// Marks a self-service endpoint that only requires a valid session (e.g.
// "log yourself out", "enroll your own MFA") — not a module.resource.action
// grant. Distinct from @Public() and from @RequirePermission(): every
// endpoint must carry exactly one of the three (deny-by-default,
// FR-RBAC-1) or PermissionGuard rejects it.
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED_ONLY_KEY, true);
