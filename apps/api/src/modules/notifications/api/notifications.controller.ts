import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Req } from "@nestjs/common";
import {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
  registerDeviceSchema,
  updateNotificationPreferencesSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { Authenticated } from "../../../platform/decorators/authenticated.decorator";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { NotificationsService } from "../application/notifications.service";

// api.md §12 (M18): these are self-service, "my notifications" endpoints —
// scoped to the caller's own userId from the access token, the same
// @Authenticated() (not @RequirePermission) pattern as /auth/logout and
// /auth/mfa/* (no module.resource.action grant needed to read your own inbox).
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("notifications")
  @Authenticated()
  list(
    @Query(new ZodValidationPipe(listNotificationsQuerySchema))
    query: z.infer<typeof listNotificationsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const auth = req.auth!;
    return this.notifications.list(auth.tenantId, auth.sub, query);
  }

  @Post("notifications:mark-read")
  @HttpCode(HttpStatus.OK)
  @Authenticated()
  async markRead(
    @Body(new ZodValidationPipe(markNotificationsReadSchema))
    body: z.infer<typeof markNotificationsReadSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const auth = req.auth!;
    await this.notifications.markRead(auth.tenantId, auth.sub, body);
    return { success: true };
  }

  @Get("notification-preferences")
  @Authenticated()
  getPreferences(@Req() req: AuthenticatedRequest) {
    const auth = req.auth!;
    return this.notifications.getPreferences(auth.tenantId, auth.sub);
  }

  @Put("notification-preferences")
  @Authenticated()
  async putPreferences(
    @Body(new ZodValidationPipe(updateNotificationPreferencesSchema))
    body: z.infer<typeof updateNotificationPreferencesSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const auth = req.auth!;
    await this.notifications.replacePreferences(auth.tenantId, auth.sub, body.preferences);
    return this.notifications.getPreferences(auth.tenantId, auth.sub);
  }

  @Post("devices")
  @Authenticated()
  async registerDevice(
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: z.infer<typeof registerDeviceSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const auth = req.auth!;
    await this.notifications.registerDevice(auth.tenantId, auth.sub, body);
    return { success: true };
  }
}
