import { z } from "zod";
import { isoDateTimeSchema, paginationQuerySchema, uuidSchema } from "./common";

// api.md §12: `GET /notifications` — `filter[unread]=true`; cursor-paginated.
export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unread: z.coerce.boolean().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

// api.md §12: `POST /notifications:mark-read` — `{ids[] | all_before}`.
export const markNotificationsReadSchema = z
  .object({
    ids: z.array(uuidSchema).optional(),
    allBefore: isoDateTimeSchema.optional(),
  })
  .refine((v) => (v.ids !== undefined) !== (v.allBefore !== undefined), {
    message: "exactly one of ids or allBefore must be provided",
  });
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

export const notificationChannelSchema = z.enum(["in_app", "email", "push", "sms"]);
export const notificationDigestSchema = z.enum(["instant", "hourly", "daily"]);

export const notificationPreferenceSchema = z.object({
  category: z.string().min(1),
  channel: notificationChannelSchema,
  enabled: z.boolean(),
  digest: notificationDigestSchema,
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

// api.md §12: `GET/PUT /notification-preferences` — category x channel x
// digest matrix (FR-PLAT-5). PUT replaces the caller's full matrix.
export const updateNotificationPreferencesSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
});
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

// api.md §12: `POST /devices` — register push token (FCM/APNs), device metadata.
export const registerDeviceSchema = z.object({
  platform: z.enum(["ios", "android", "web"]),
  pushToken: z.string().min(1),
  deviceName: z.string().optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
