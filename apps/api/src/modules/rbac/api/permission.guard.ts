import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../../auth";
import { IS_AUTHENTICATED_ONLY_KEY } from "../../../platform/decorators/authenticated.decorator";
import { IS_PUBLIC_KEY } from "../../../platform/decorators/public.decorator";
import { PermissionDeniedError } from "../domain/errors";
import { PermissionResolverService } from "../application/permission-resolver.service";
import { REQUIRED_PERMISSION_KEY } from "./require-permission.decorator";

// architecture.md §12 layer 1 (API guard) + FR-RBAC-1 deny-by-default:
// every route must declare exactly one of @Public(), @Authenticated(), or
// @RequirePermission(key) — anything else is treated as a misconfigured,
// unguarded endpoint and rejected, not silently allowed. Runs after
// AccessTokenGuard (app.module.ts APP_GUARD order), which populates
// request.auth.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isAuthenticatedOnly = this.reflector.getAllAndOverride<boolean>(
      IS_AUTHENTICATED_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) throw new UnauthorizedException();

    if (isAuthenticatedOnly) return true;
    if (!required) throw new PermissionDeniedError("(none declared — endpoint misconfigured)");

    const granted = await this.permissions.has(auth.tenantId, auth.sub, required);
    if (!granted) throw new PermissionDeniedError(required);
    return true;
  }
}
