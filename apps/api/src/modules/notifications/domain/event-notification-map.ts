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
};

export function draftNotifications(envelope: OutboxEnvelope): NotificationDraft[] {
  const builder = builders[envelope.eventType as EventType];
  if (!builder) return [];
  const result = builder(envelope.payload as Record<string, unknown>);
  return Array.isArray(result) ? result : [result];
}
