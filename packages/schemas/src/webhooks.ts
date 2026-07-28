import { z } from "zod";
import { paginationQuerySchema } from "./common";
import { eventRegistry } from "./events";

// api.md §16.3: "Webhook API (outbound) ... Endpoint CRUD: {url, secret,
// event_types[]} ... Event catalog = the domain event registry ... —
// versioned, documented, additive." Validating subscribedEvents against the
// real event registry (not a bare string array) catches typos at input
// time and keeps "the event catalog" and "what a webhook can subscribe to"
// from silently drifting apart.
const webhookEventTypeKeys = Object.keys(eventRegistry) as [string, ...string[]];
export const webhookEventTypeSchema = z.enum(webhookEventTypeKeys);

export const createWebhookEndpointSchema = z.object({
  url: z.string().url(),
  // Chosen by the caller (not server-generated) — matches api.md's literal
  // request-body shape listing `secret` alongside `url`/`event_types[]`,
  // same as the receiving system's own webhook secret in Stripe/GitHub-
  // style integrations the caller already configures on their end.
  secret: z.string().min(16).max(256),
  subscribedEvents: z.array(webhookEventTypeSchema).min(1).max(100),
});
export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;

export const updateWebhookEndpointSchema = z.object({
  url: z.string().url().optional(),
  secret: z.string().min(16).max(256).optional(),
  subscribedEvents: z.array(webhookEventTypeSchema).min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointSchema>;

export const listWebhookDeliveriesQuerySchema = paginationQuerySchema;
export type ListWebhookDeliveriesQuery = z.infer<typeof listWebhookDeliveriesQuerySchema>;
