import { z } from "zod";
import { moneyAmountSchema } from "./common";

// api.md §15.1 "Agent identities" (ai-spec.md §15, roadmap "Agent runtime
// GA"). tool_allowlist[] is validated against the live tool-runner
// registry at the service layer (like grantPermissionToRole's
// UnknownPermissionError), not a static zod enum, since the registry is
// assembled per-conversation-type, not a compile-time-known set here.
export const createAgentIdentitySchema = z.object({
  name: z.string().min(1).max(200),
  purpose: z.string().min(1).max(2000),
  roleId: z.string().uuid(),
  toolAllowlist: z.array(z.string().min(1)).min(1).max(50),
  budgetMonthlyUsd: moneyAmountSchema.optional(),
  escalationContacts: z.array(z.string().email()).max(10).optional(),
});
export type CreateAgentIdentityInput = z.infer<typeof createAgentIdentitySchema>;

export const updateAgentIdentitySchema = z.object({
  purpose: z.string().min(1).max(2000).optional(),
  toolAllowlist: z.array(z.string().min(1)).min(1).max(50).optional(),
  budgetMonthlyUsd: moneyAmountSchema.nullable().optional(),
  escalationContacts: z.array(z.string().email()).max(10).optional(),
});
export type UpdateAgentIdentityInput = z.infer<typeof updateAgentIdentitySchema>;
