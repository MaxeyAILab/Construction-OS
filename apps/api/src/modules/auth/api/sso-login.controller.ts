import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Redirect, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "../../../platform/decorators/public.decorator";
import { AuthService } from "../application/auth.service";
import { SsoConnectionsService } from "../application/sso-connections.service";
import { SsoConnectionNotFoundError } from "../domain/errors";
import { SamlService } from "../infrastructure/saml.service";

// api.md §2.1: the login flow itself has no session yet, so every route
// here is @Public() — same posture as /auth/login, /auth/magic-link.
@Controller("auth/sso")
export class SsoLoginController {
  constructor(
    private readonly auth: AuthService,
    private readonly connections: SsoConnectionsService,
    private readonly saml: SamlService,
  ) {}

  @Get(":connectionId/metadata")
  @Public()
  async metadata(@Param("connectionId") connectionId: string, @Res() reply: FastifyReply) {
    const connection = await this.requireConnection(connectionId);
    reply.header("content-type", "application/xml").send(this.saml.spMetadata(connection));
  }

  @Get(":connectionId/login")
  @Public()
  @Redirect()
  async login(@Param("connectionId") connectionId: string) {
    const connection = await this.requireConnection(connectionId);
    const url = await this.saml.getLoginUrl(connection);
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Post(":connectionId/acs")
  @Public()
  @HttpCode(HttpStatus.OK)
  acs(@Param("connectionId") connectionId: string, @Body() body: Record<string, string>, @Req() req: FastifyRequest) {
    return this.auth.loginViaSso(connectionId, body, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  private async requireConnection(connectionId: string) {
    const connection = await this.connections.getForLogin(connectionId);
    if (!connection) throw new SsoConnectionNotFoundError();
    return connection;
  }
}
