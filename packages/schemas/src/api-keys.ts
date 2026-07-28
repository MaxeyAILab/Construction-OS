import { z } from "zod";

// api.md §16.4: "Create {name, scopes[]}". Scopes are validated against the
// real permission catalog at the service layer (like grantPermissionToRole's
// UnknownPermissionError) rather than a static zod enum, since the catalog
// is DB-seeded, not a compile-time-known set.
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1)).min(1).max(50),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
