import type { EventType, OutboxEnvelope } from "@constructionos/schemas";

export interface NotificationDraft {
  recipientUserId: string;
  category: string;
  kind: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

type NotificationBuilder = (payload: Record<string, unknown>) => NotificationDraft | NotificationDraft[];

// architecture.md §10 pipeline step 1: "event -> eligibility". For these two
// event types the recipient is the direct subject named in the payload
// (you can't be invited or assigned a role without being that user), so
// eligibility collapses to "does this event map to a notification at all" —
// broader-audience events (e.g. a future budget-threshold alert reaching
// every project member) will need a real fan-out/eligibility step, not yet
// built since no such event exists yet.
const builders: Partial<Record<EventType, NotificationBuilder>> = {
  "user.invited.v1": (payload) => ({
    recipientUserId: payload.userId as string,
    category: "user.invited",
    kind: "user_invited",
    title: "You've been invited",
    body: "You've been invited to join a company on ConstructionOS.",
    entityType: "company",
    entityId: payload.companyId as string,
  }),
  "role.assigned.v1": (payload) => ({
    recipientUserId: payload.userId as string,
    category: "role.assigned",
    kind: "role_assigned",
    title: "New role assigned",
    body: "You were assigned a new role.",
    entityType: "role",
    entityId: payload.roleId as string,
  }),
  // database.md §17: "mentions uuid[] (drives notifications)" — one draft
  // per mentioned user, the first builder here that needs real fan-out
  // rather than a single named recipient.
  "comment.created.v1": (payload) => {
    const mentions = payload.mentions as string[];
    return mentions.map((userId) => ({
      recipientUserId: userId,
      category: "comment.mention",
      kind: "comment_mention",
      title: "You were mentioned in a comment",
      body: "Someone mentioned you in a comment.",
      entityType: payload.entityType as string,
      entityId: payload.entityId as string,
    }));
  },
  // api.md §9 "Publishes to portal + notification" (FR-FIN-2). Single
  // recipient — the CO's own author — same shape as user.invited.v1/
  // role.assigned.v1.
  "change_order.approved.v1": (payload) => ({
    recipientUserId: payload.createdBy as string,
    category: "change_order.decided",
    kind: "change_order_approved",
    title: "Change order approved",
    body: "Your change order was approved.",
    entityType: "change_order",
    entityId: payload.changeOrderId as string,
  }),
  "change_order.rejected.v1": (payload) => ({
    recipientUserId: payload.createdBy as string,
    category: "change_order.decided",
    kind: "change_order_rejected",
    title: "Change order rejected",
    body: "Your change order was rejected.",
    entityType: "change_order",
    entityId: payload.changeOrderId as string,
  }),
  // notifyUserIds is every principal with an active external_shares grant
  // on this change order (see ChangeOrderLifecycleService.submitToClient) —
  // the other real fan-out case alongside comment.created.v1's mentions,
  // rather than a single named recipient.
  "change_order.submitted_to_client.v1": (payload) => {
    const notifyUserIds = payload.notifyUserIds as string[];
    return notifyUserIds.map((userId) => ({
      recipientUserId: userId,
      category: "change_order.submitted",
      kind: "change_order_submitted_to_client",
      title: "Change order awaiting your approval",
      body: "A change order has been submitted for your approval.",
      entityType: "change_order",
      entityId: payload.changeOrderId as string,
    }));
  },
  // api.md §16.3: "dead-letter + notification". createdBy carries the
  // endpoint's owner directly (no cross-module lookup needed) — same
  // single-recipient shape as user.invited.v1/role.assigned.v1 above. A
  // system-created endpoint (createdBy null) has no one to notify, so it
  // produces no draft rather than guessing a recipient.
  "webhook_delivery.dead_lettered.v1": (payload) => {
    const createdBy = payload.createdBy as string | null;
    if (!createdBy) return [];
    return [
      {
        recipientUserId: createdBy,
        category: "webhook.dead_lettered",
        kind: "webhook_delivery_dead_lettered",
        title: "Webhook delivery failed",
        body: `Delivery of ${payload.eventType as string} to your webhook endpoint failed after repeated retries.`,
        entityType: "webhook_endpoint",
        entityId: payload.webhookEndpointId as string,
      },
    ];
  },
  // api.md §15.6 "Executive Briefing Agent" / FR-EXEC-3, ai-spec.md §7.1
  // "weekly proactive briefing (notification + portal card)" — the
  // notification half. notifyUserId is null for a human's own on-demand
  // POST .../briefing call (no one to notify but the caller, who already
  // has the response) — same "no creator = no draft" shape as
  // webhook_delivery.dead_lettered.v1 above.
  "company_briefing.generated.v1": (payload) => {
    const notifyUserId = payload.notifyUserId as string | null;
    if (!notifyUserId) return [];
    return [
      {
        recipientUserId: notifyUserId,
        category: "dashboards.briefing",
        kind: "company_briefing_generated",
        title: "Your weekly executive briefing is ready",
        body: "A new company-wide briefing covering pipeline, cash flow, and schedule risk is ready to review.",
        entityType: "company_briefing",
        entityId: payload.companyBriefingId as string,
      },
    ];
  },
  // database.md §24 / api.md §19 (FR-PLAT-12): the notify_user automation
  // action reuses this exact pipeline rather than a new delivery
  // mechanism — same "no notifyUserId = no draft" shape as
  // company_briefing.generated.v1 (a set_field-triggered event never
  // reaches here at all, see CustomFieldAutomationsService).
  "custom_field_automation.triggered.v1": (payload) => {
    const notifyUserId = payload.notifyUserId as string | null;
    if (!notifyUserId) return [];
    return [
      {
        recipientUserId: notifyUserId,
        category: "custom_field.automation",
        kind: "custom_field_automation_triggered",
        title: "A custom field update notified you",
        body: "A custom field automation rule triggered a notification for you.",
        entityType: payload.entityType as string,
        entityId: payload.entityId as string,
      },
    ];
  },
};

export function draftNotifications(envelope: OutboxEnvelope): NotificationDraft[] {
  const builder = builders[envelope.eventType as EventType];
  if (!builder) return [];
  const result = builder(envelope.payload as Record<string, unknown>);
  return Array.isArray(result) ? result : [result];
}
