import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ScimAuthContext } from "../application/sso-connections.service";
import { SsoConnectionsService } from "../application/sso-connections.service";

export type ScimAuthenticatedRequest = FastifyRequest & { scimAuth?: ScimAuthContext };

// api.md §2.1: SCIM endpoints authenticate with a connection-scoped bearer
// token, not a company session or X-Api-Key — there is no RBAC principal
// involved (the token *is* the complete authorization, same as a webhook
// signature), so these routes are marked @Public() to skip the global
// AccessTokenGuard/PermissionGuard entirely and rely on this guard
// (applied per-controller via @UseGuards) instead.
@Injectable()
export class ScimAuthGuard implements CanActivate {
  constructor(private readonly ssoConnections: SsoConnectionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ScimAuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing SCIM bearer token");
    }

    const resolved = await this.ssoConnections.resolveScimAuth(header.slice("Bearer ".length));
    if (!resolved) throw new UnauthorizedException("invalid or revoked SCIM token");

    request.scimAuth = resolved;
    return true;
  }
}
