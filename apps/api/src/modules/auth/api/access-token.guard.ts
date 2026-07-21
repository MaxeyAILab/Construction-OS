import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
// Real (non-type-only) imports required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime, not just its type.
import { SessionDenylistService } from "../infrastructure/session-denylist.service";
import { type AccessTokenPayload, TokenService } from "../infrastructure/token.service";

export type AuthenticatedRequest = FastifyRequest & { auth?: AccessTokenPayload };

// Establishes *who* the caller is (architecture.md §12 layer 1, the API
// guard). Permission-based `@RequirePermission(...)` enforcement is the
// RBAC roadmap row, built on top of this once it lands.
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly denylist: SessionDenylistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
