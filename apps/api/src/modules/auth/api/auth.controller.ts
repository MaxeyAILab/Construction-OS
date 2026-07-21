import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  loginSchema,
  magicLinkConsumeSchema,
  magicLinkRequestSchema,
  mfaConfirmSchema,
  refreshSchema,
  signUpSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
// AuthService import must stay a real (non-type-only) import: NestJS
// constructor injection resolves it via emitDecoratorMetadata, which needs
// the actual class reference at runtime.
import { AuthService, type DeviceContext } from "../application/auth.service";
import { AccessTokenGuard, type AuthenticatedRequest } from "./access-token.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // api.md §2: POST /auth/register — "Create company + owner account".
  @Post("register")
  register(
    @Body(new ZodValidationPipe(signUpSchema)) body: z.infer<typeof signUpSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.signUp(body, this.deviceContext(req));
  }

  @Post("login")
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.login(body, this.deviceContext(req));
  }

  @Post("refresh")
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.refresh(body.refreshToken, this.deviceContext(req));
  }

  // api.md §2: POST /auth/logout — "Revoke session family" — 204.
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessTokenGuard)
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException();
    await this.auth.logout(auth.tenantId, auth.sessionId, auth.jti, new Date());
  }

  @Post("mfa/enroll")
  @UseGuards(AccessTokenGuard)
  startMfaEnrollment(@Req() req: AuthenticatedRequest) {
    return this.auth.startMfaEnrollment(req.auth!.sub);
  }

  @Post("mfa/confirm")
  @UseGuards(AccessTokenGuard)
  async confirmMfaEnrollment(
    @Body(new ZodValidationPipe(mfaConfirmSchema)) body: z.infer<typeof mfaConfirmSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.auth.confirmMfaEnrollment(req.auth!.sub, body.secret, body.totpCode);
    return { success: true };
  }

  // api.md §2: POST /auth/magic-link — "Client/external low-friction login".
  // The documented table lists one path for the whole flow; split here into
  // request (send) + verify (consume) since those are two distinct calls —
  // named to match the /auth/mfa/verify convention.
  @Post("magic-link")
  async requestMagicLink(
    @Body(new ZodValidationPipe(magicLinkRequestSchema))
    body: z.infer<typeof magicLinkRequestSchema>,
  ) {
    const token = await this.auth.requestMagicLink(body.email, body.companyId);
    // Delivery (email) is the Notification Service — a separate, not-yet-built
    // roadmap row. Returned directly for now so the flow is usable end to end.
    return { token };
  }

  @Post("magic-link/verify")
  consumeMagicLink(
    @Body(new ZodValidationPipe(magicLinkConsumeSchema))
    body: z.infer<typeof magicLinkConsumeSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.consumeMagicLink(body.token, this.deviceContext(req));
  }

  private deviceContext(req: AuthenticatedRequest): DeviceContext {
    const deviceId = req.headers["x-device-id"];
    return {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      deviceId: Array.isArray(deviceId) ? deviceId[0] : deviceId,
    };
  }
}
