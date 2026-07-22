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

type NotificationBuilder = (payload: Record<string, unknown>) => NotificationDraft;

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
};

export function draftNotification(envelope: OutboxEnvelope): NotificationDraft | null {
  const builder = builders[envelope.eventType as EventType];
  if (!builder) return null;
  return builder(envelope.payload as Record<string, unknown>);
}
