export interface ChannelDeliveryResult {
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

export interface ChannelNotificationPayload {
  title: string;
  body: string;
  category: string;
}

// architecture.md §10: "channel adapters (... email via SES/Postmark, push
// via FCM/APNs, SMS via Twilio — adapter interface, providers swappable)".
// No vendor credentials exist yet (same deferred-infra situation as the
// Supabase connection), so EmailChannel/PushChannel below are logging stubs
// behind this interface — swapping in a real SES/FCM implementation later
// touches only their `send()` bodies, not any caller.
export interface NotificationChannelAdapter {
  send(
    tenantId: string,
    userId: string,
    notification: ChannelNotificationPayload,
  ): Promise<ChannelDeliveryResult>;
}

// Injection tokens: interfaces don't exist at runtime, so DI needs a token
// (not the interface type) — the notifications.module.ts provider binding
// (`{ provide: EMAIL_CHANNEL, useClass: EmailChannel }`) is the actual
// swap point for a real vendor implementation later.
export const EMAIL_CHANNEL = Symbol("EMAIL_CHANNEL");
export const PUSH_CHANNEL = Symbol("PUSH_CHANNEL");
