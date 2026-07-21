import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { IS_PUBLIC_KEY } from "../../../platform/decorators/public.decorator";
// Real (non-type-only) imports required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime.
import { Reflector } from "@nestjs/core";
import { SessionDenylistService } from "../infrastructure/session-denylist.service";
import { type AccessTokenPayload, TokenService } from "../infrastructure/token.service";

export type AuthenticatedRequest = FastifyRequest & { auth?: AccessTokenPayload };

// Establishes *who* the caller is (architecture.md §12 layer 1, the API
// guard) — registered globally (APP_GUARD, app.module.ts) so every
// endpoint requires a valid token unless marked @Public(). Runs before
// PermissionGuard (rbac module), which handles *what* they can do.
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly denylist: SessionDenylistService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing bearer token");
    }

    const token = header.slice("Bearer ".length);
    let payload: AccessTokenPayload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException("invalid or expired access token");
    }

    if (await this.denylist.isDenylisted(payload.jti)) {
      throw new UnauthorizedException("token has been revoked");
    }

    request.auth = payload;
    return true;
  }
}
