import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from "@nestjs/common";
import {
  loginSchema,
  magicLinkConsumeSchema,
  magicLinkRequestSchema,
  mfaConfirmSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  refreshSchema,
  signUpSchema,
  updateUserPreferencesSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { Public } from "../../../platform/decorators/public.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
// AuthService import must stay a real (non-type-only) import: NestJS
// constructor injection resolves it via emitDecoratorMetadata, which needs
// the actual class reference at runtime.
import { AuthService, type DeviceContext } from "../application/auth.service";
import { UserPreferencesService } from "../application/user-preferences.service";
import type { AuthenticatedRequest } from "./access-token.guard";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly preferences: UserPreferencesService,
  ) {}

  // api.md §2: POST /auth/register — "Create company + owner account".
  @Post("register")
  @Public()
  register(
    @Body(new ZodValidationPipe(signUpSchema)) body: z.infer<typeof signUpSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.signUp(body, this.deviceContext(req));
  }

  @Post("login")
  @Public()
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.login(body, this.deviceContext(req));
  }

  // api.md §2: POST /auth/password/forgot -> /auth/password/reset | Reset
  // flow | Public, tokenized. Always 202 — never reveals whether the email
  // is registered.
  @Post("password/forgot")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema))
    body: z.infer<typeof passwordResetRequestSchema>,
  ): Promise<void> {
    // Real delivery (email) is the Notification Service, a separate roadmap
    // row not yet built. The token is deliberately not returned here (unlike
    // the magic-link stopgap) since this endpoint's whole point is to never
    // reveal anything to the caller either way.
    await this.auth.requestPasswordReset(body.email);
  }

  @Post("password/reset")
  @Public()
  async resetPassword(
    @Body(new ZodValidationPipe(passwordResetSchema)) body: z.infer<typeof passwordResetSchema>,
  ) {
    await this.auth.resetPassword(body.token, body.newPassword);
    return { success: true };
  }

  @Post("refresh")
  @Public()
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.refresh(body.refreshToken, this.deviceContext(req));
  }

  // api.md §2: POST /auth/logout — "Revoke session family" — 204.
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    const auth = req.auth!;
    await this.auth.logout(auth.tenantId, auth.sessionId, auth.jti, new Date());
  }

  @Post("mfa/enroll")
  @Authenticated()
  startMfaEnrollment(@Req() req: AuthenticatedRequest) {
    return this.auth.startMfaEnrollment(req.auth!.sub);
  }

  @Post("mfa/confirm")
  @Authenticated()
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
  @Public()
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
  @Public()
  consumeMagicLink(
    @Body(new ZodValidationPipe(magicLinkConsumeSchema))
    body: z.infer<typeof magicLinkConsumeSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.auth.consumeMagicLink(body.token, this.deviceContext(req));
  }

  // api.md §2: "GET /auth/me | Current principal: user, tenant, roles,
  // permissions, entitlements." Just @Authenticated() — every principal may
  // read their own identity, no RBAC permission gate involved. "entitlements"
  // is omitted from the response — no billing/plan/entitlements concept
  // exists anywhere in this codebase yet (flagged gap, not invented).
  @Get("me")
  @Authenticated()
  getMe(@Req() req: AuthenticatedRequest) {
    const auth = req.auth!;
    return this.auth.getMe(auth.tenantId, auth.sub, auth.roles);
  }

  // api.md §2: "GET/PATCH /auth/me/preferences | Locale, notification
  // prefs." Just @Authenticated() — a user always may read/update their
  // own preferences, no RBAC permission gate involved.
  @Get("me/preferences")
  @Authenticated()
  getPreferences(@Req() req: AuthenticatedRequest) {
    return this.preferences.get(req.auth!.sub);
  }

  @Patch("me/preferences")
  @Authenticated()
  updatePreferences(
    @Body(new ZodValidationPipe(updateUserPreferencesSchema))
    body: z.infer<typeof updateUserPreferencesSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.preferences.update(req.auth!.tenantId, req.auth!.sub, body);
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
